## Description

This example shows how to deposit to the Real Yield USD vault on Arbitrum in one click, using any token on any chain.

[Sommelier App](https://app.sommelier.finance/strategies/real-yield-usd-arb/manage)

The route in the example is Binance BNB to Arbitrum USDC, then a custom call sequence to approve the Sommelier Vault contract, then to deposit USDC and receive RYUSD.

The token you will receive is RYUSD

Address: 0x392b1e6905bb8449d26af701cdea6ff47bf6e5a8

Name: Real Yield USD

## Quick start

```bash
cd V1/depositFromAnyChainSommelier
yarn install
```

Create file `.env`
Copy contents of `.env.example` into `.env`
Add your private key in the env file. (Make sure you have some BNB in your wallet. Get some at [Squid](https://app.squidrouter.com) if you need some)

```
yarn start
```
