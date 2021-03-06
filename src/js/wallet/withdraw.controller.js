(function () {
    'use strict';

    var DEFAULT_FEE_AMOUNT = '0.001',
        DEFAULT_ERROR_MESSAGE = 'Connection is lost';

    function WavesWalletWithdrawController ($scope, $timeout, constants, events, autocomplete, dialogService,
                                            coinomatService, transactionBroadcast, notificationService,
                                            apiService, formattingService, assetService, applicationContext) {
        var withdraw = this;
        var minimumFee = new Money(constants.MINIMUM_TRANSACTION_FEE, Currency.WAVES);
        var notPermittedBitcoinAddresses = {};

        withdraw.broadcast = new transactionBroadcast.instance(apiService.assets.transfer,
            function (transaction, response) {
                var amount = Money.fromCoins(transaction.amount, withdraw.assetBalance.currency);
                var address = transaction.recipient;
                var displayMessage = 'Sent ' + amount.formatAmount(true) + ' of ' +
                    withdraw.assetBalance.currency.displayName +
                    '<br/>Gateway ' + address.substr(0,15) + '...<br/>Date: ' +
                    formattingService.formatTimestamp(transaction.timestamp);
                notificationService.notice(displayMessage);
            });
        withdraw.autocomplete = autocomplete;
        withdraw.validationOptions = {
            onfocusout: function (element) {
                return !(element.name in ['withdrawFee']); // FIXME
            },
            rules: {
                withdrawAddress: {
                    required: true
                },
                withdrawAmount: {
                    required: true,
                    decimal: 8,
                    min: 0,
                    max: constants.JAVA_MAX_LONG
                },
                withdrawFee: {
                    required: true,
                    decimal: Currency.WAVES.precision,
                    min: minimumFee.toTokens()
                },
                withdrawTotal: {
                    required: true,
                    decimal: 8,
                    min: 0,
                    max: constants.JAVA_MAX_LONG
                }
            },
            messages: {
                withdrawAddress: {
                    required: 'Bitcoin address is required'
                },
                withdrawAmount: {
                    required: 'Amount to withdraw is required'
                },
                withdrawFee: {
                    required: 'Gateway transaction fee is required',
                    decimal: 'Transaction fee must be with no more than ' +
                        minimumFee.currency.precision + ' digits after the decimal point (.)',
                    min: 'Transaction fee is too small. It should be greater or equal to ' +
                        minimumFee.formatAmount(true)
                },
                withdrawTotal: {
                    required: 'Total amount is required'
                }
            }
        };
        withdraw.confirm = {
            amount: {},
            fee: {},
            gatewayAddress: '',
            address: ''
        };
        withdraw.confirmWithdraw = confirmWithdraw;
        withdraw.refreshAmount = refreshAmount;
        withdraw.refreshTotal = refreshTotal;
        withdraw.broadcastTransaction = broadcastTransaction;

        resetForm();

        $scope.$on(events.WALLET_WITHDRAW, function (event, eventData) {
            withdraw.assetBalance = eventData.assetBalance;
            withdraw.wavesBalance = eventData.wavesBalance;

            if (withdraw.assetBalance.currency !== Currency.BTC) {
                $scope.home.featureUnderDevelopment();

                return;
            }

            coinomatService.getWithdrawRate(withdraw.assetBalance.currency)
                .then(function (response) {
                    /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
                    var minimumPayment = Money.fromCoins(1, withdraw.assetBalance.currency);
                    minimumPayment = Money.fromTokens(Math.max(minimumPayment.toTokens(), response.in_min),
                        withdraw.assetBalance.currency);
                    var maximumPayment = Money.fromTokens(Math.min(withdraw.assetBalance.toTokens(),
                        response.in_max), withdraw.assetBalance.currency);
                    withdraw.sourceCurrency = withdraw.assetBalance.currency.displayName;
                    withdraw.exchangeRate = response.xrate;
                    withdraw.feeIn = response.fee_in;
                    withdraw.feeOut = response.fee_out;
                    withdraw.targetCurrency = response.to_txt;
                    withdraw.total = response.in_def;
                    /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */
                    withdraw.validationOptions.rules.withdrawAmount.decimal = withdraw.assetBalance.currency.precision;
                    withdraw.validationOptions.rules.withdrawAmount.max = maximumPayment.toTokens();
                    withdraw.validationOptions.rules.withdrawAmount.min = minimumPayment.toTokens();
                    withdraw.validationOptions.messages.withdrawAmount.decimal = 'The amount to withdraw must be ' +
                        'a number with no more than ' + minimumPayment.currency.precision +
                        ' digits after the decimal point (.)';
                    withdraw.validationOptions.messages.withdrawAmount.min = 'Withdraw amount is too small. ' +
                        'It should be greater or equal to ' + minimumPayment.formatAmount();
                    withdraw.validationOptions.messages.withdrawAmount.max = 'Withdraw amount is too big. ' +
                        'It should be less or equal to ' + maximumPayment.formatAmount();

                    refreshAmount();

                    dialogService.open('#withdraw-asset-dialog');
                }).catch(function (exception) {
                    if (exception && exception.data && exception.data.error) {
                        notificationService.error(exception.error);
                    } else {
                        notificationService.error(DEFAULT_ERROR_MESSAGE);
                    }
                }).then(function () {
                    return coinomatService.getDepositDetails(Currency.BTC, Currency.BTC,
                        applicationContext.account.address);
                }).then(function (depositDetails) {
                    notPermittedBitcoinAddresses[depositDetails.address] = 1;

                    return coinomatService.getDepositDetails(Currency.BTC, Currency.WAVES,
                        applicationContext.account.address);
                }).then(function (depositDetails) {
                    notPermittedBitcoinAddresses[depositDetails.address] = 1;
                });
        });

        function validateRecipientAddress(recipient) {
            if (!recipient.match(/^[0-9a-z]{27,34}$/i)) {
                throw new Error('Bitcoin address is invalid. Expected address length is from 27 to 34 symbols');
            }

            if (notPermittedBitcoinAddresses[recipient]) {
                throw new Error('Withdraw on deposit bitcoin accounts is not permitted');
            }
        }

        function validateWithdrawCost(withdrawCost, availableFunds) {
            if (withdrawCost.greaterThan(availableFunds)) {
                throw new Error('Not enough Waves for the withdraw transfer');
            }
        }

        function confirmWithdraw (amountForm) {
            if (!amountForm.validate(withdraw.validationOptions)) {
                return false;
            }

            try {
                var withdrawCost = Money.fromTokens(withdraw.autocomplete.getFeeAmount(), Currency.WAVES);
                validateWithdrawCost(withdrawCost, withdraw.wavesBalance);
                validateRecipientAddress(withdraw.recipient);
            }
            catch (exception) {
                notificationService.error(exception.message);

                return false;
            }

            var total = Money.fromTokens(withdraw.total, withdraw.assetBalance.currency);
            var fee = Money.fromTokens(withdraw.autocomplete.getFeeAmount(), Currency.WAVES);
            withdraw.confirm.amount = total;
            withdraw.confirm.fee = fee;
            withdraw.confirm.recipient = withdraw.recipient;

            coinomatService.getWithdrawDetails(withdraw.assetBalance.currency, withdraw.recipient)
                .then(function (withdrawDetails) {
                    withdraw.confirm.gatewayAddress = withdrawDetails.address;

                    var assetTransfer = {
                        recipient: withdrawDetails.address,
                        amount: total,
                        fee: fee,
                        attachment: converters.stringToByteArray(withdrawDetails.attachment)
                    };
                    var sender = {
                        publicKey: applicationContext.account.keyPair.public,
                        privateKey: applicationContext.account.keyPair.private
                    };
                    // creating the transaction and waiting for confirmation
                    withdraw.broadcast.setTransaction(assetService.createAssetTransferTransaction(assetTransfer,
                        sender));

                    resetForm();

                    dialogService.open('#withdraw-confirmation');
                })
                .catch(function (exception) {
                    notificationService.error(exception.message);
                });

            return true;
        }

        function broadcastTransaction () {
            withdraw.broadcast.broadcast();
        }

        function refreshTotal () {
            var amount = withdraw.exchangeRate * withdraw.amount;
            var total = Money.fromTokens(amount + withdraw.feeIn + withdraw.feeOut, withdraw.assetBalance.currency);
            withdraw.total = total.formatAmount(true, false);
        }

        function refreshAmount () {
            var total = Math.max(0, withdraw.exchangeRate * (withdraw.total - withdraw.feeIn) - withdraw.feeOut);
            var amount = Money.fromTokens(total, withdraw.assetBalance.currency);
            withdraw.amount = amount.formatAmount(true, false);
        }

        function resetForm () {
            withdraw.recipient = '';
            withdraw.address = '';
            withdraw.autocomplete.defaultFee(Number(DEFAULT_FEE_AMOUNT));
        }
    }

    WavesWalletWithdrawController.$inject = ['$scope', '$timeout', 'constants.ui', 'wallet.events', 'autocomplete.fees',
        'dialogService', 'coinomatService', 'transactionBroadcast', 'notificationService', 'apiService',
        'formattingService', 'assetService', 'applicationContext'];

    angular
        .module('app.wallet')
        .controller('walletWithdrawController', WavesWalletWithdrawController);
})();
