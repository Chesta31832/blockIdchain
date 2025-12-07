require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const { GANACHE_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    ganache: {
      url: GANACHE_RPC_URL || "http://127.0.0.1:7545",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : undefined,
    },
  },
  paths: {
    scripts: "./scripts",
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
