const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Contract = await hre.ethers.getContractFactory("BlockIDChain");
  const instance = await Contract.deploy();
  await instance.waitForDeployment();

  const deployedAddress = await instance.getAddress();
  console.log("BlockIDChain deployed to:", deployedAddress);

  const artifact = await hre.artifacts.readArtifact("contracts/BlockIDChain.sol:BlockIDChain");
  const payload = {
    address: deployedAddress,
    abi: artifact.abi,
    network: hre.network.name
  };

  const targets = [
    path.join(__dirname, "../../backend/src/contract.json"),
    path.join(__dirname, "../../frontend/src/contract.json")
  ];

  targets.forEach((target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    console.log("Wrote", target);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
