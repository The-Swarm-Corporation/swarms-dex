# Swarms DEX 🦾

A decentralized exchange platform for creating and trading Swarms tokens with automated market making capabilities.

## Features 🚀

- Create new tokens with customizable parameters
- Set up liquidity pools with automated market making
- Trade tokens with real-time price updates
- View detailed token information and market statistics
- User-friendly interface for managing your tokens and pools

## Prerequisites 📋

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Yarn](https://yarnpkg.com/) package manager
- A Web3 wallet (e.g., MetaMask)

## Installation 🛠️

1. Clone the repository:
```bash
git clone https://github.com/The-Swarm-Corporation/swarms-dex.git
cd swarms-dex
```

2. Install dependencies:
```bash
yarn install
```

3. Create a `.env` file in the root directory with your configuration:
```env
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_wallet_connect_project_id
```

## Development 💻

To run the development server:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Usage Guide 📖

### Creating a Token

1. Connect your Web3 wallet
2. Navigate to the "Create Token" page
3. Fill in the token details:
   - Token name
   - Symbol
   - Initial supply
   - Description
4. Confirm the transaction in your wallet

### Setting up a Liquidity Pool

1. Navigate to the "Pools" section
2. Click "Create New Pool"
3. Select your token and the paired token
4. Set initial liquidity amounts
5. Approve token spending and confirm pool creation

### Trading

1. Go to the "Trade" page
2. Select the tokens you want to trade
3. Enter the amount
4. Review the transaction details
5. Confirm the swap

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

This project is licensed under the MIT License - see the LICENSE file for details.

## Support 💬

For support, please join our [Discord community](https://discord.gg/your-discord) or open an issue on GitHub.

