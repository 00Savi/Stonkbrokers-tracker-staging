const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://rpc.ankr.com/arbitrum";
const ACTIVATION_CONTRACT = "0xacd5ae3c060c1137fe2ee86b0ab2ef697456f664";
const STONK_TOKEN_CONTRACT = "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0";

const DEAD_ADDRESSES = [
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000"
];

async function runFetcher() {
  console.log("Starting StonkBrokers Dual-Sink Burn & ROI Fetcher (Staging)...");
  
  // Explicitly passing network configuration and staticNetwork to bypass auto-detection hangs
  const network = { name: "arbitrum", chainId: 42161 };
  const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });

  let contractLockedTokens = 0n;
  try {
    const erc20Abi = ["function balanceOf(address account) view returns (uint256)"];
    const tokenContract = new ethers.Contract(STONK_TOKEN_CONTRACT, erc20Abi, provider);
    contractLockedTokens = await tokenContract.balanceOf(ACTIVATION_CONTRACT);
    console.log("Tokens locked in Activation Contract:", ethers.formatUnits(contractLockedTokens, 18));
  } catch (err) {
    console.warn("Could not fetch contract balance directly, using fallback estimation:", err.message);
    contractLockedTokens = ethers.parseUnits("145000000", 18);
  }

  let directBurnTokens = 0n;
  try {
    const erc20Abi = ["function balanceOf(address account) view returns (uint256)"];
    const tokenContract = new ethers.Contract(STONK_TOKEN_CONTRACT, erc20Abi, provider);
    for (const deadAddr of DEAD_ADDRESSES) {
      const bal = await tokenContract.balanceOf(deadAddr);
      directBurnTokens += bal;
    }
    console.log("Tokens in Direct Burn Addresses:", ethers.formatUnits(directBurnTokens, 18));
  } catch (err) {
    console.warn("Could not fetch direct burn balance:", err.message);
    directBurnTokens = ethers.parseUnits("154160000", 18);
  }

  const totalCombinedBurnedTokens = directBurnTokens + contractLockedTokens;
  const estimatedBrokersBurnt = Number(ethers.formatUnits(totalCombinedBurnedTokens, 18)) / 666666;

  console.log(`Calculated Total Burnt / Locked Equivalent: ~${estimatedBrokersBurnt.toFixed(2)} Brokers`);

  const marketData = {
    ethPriceUsd: 1924.74,
    tokenPriceUsd: 0.03,
    nftFloorEth: 11.362,
    lastUpdated: new Date().toISOString()
  };

  const activationMetrics = {
    activeCount: 842,
    percentActivated: 38.5,
    totalSupply: 4444,
    breakdown: { T0: 320, T1: 210, T2: 160, T3: 95, T4: 57 },
    history: {
      labels: ["7/15", "7/20", "7/25", "7/30", "8/3", "8/7", "Today"],
      cumulative: [420, 510, 600, 680, 740, 790, 842]
    },
    dualSinkBurn: {
      totalBurnTokens: ethers.formatUnits(totalCombinedBurnedTokens, 18),
      equivalentBrokersBurnt: estimatedBrokersBurnt.toFixed(2)
    }
  };

  const tiersData = [
    { tier: "T0", name: "Floor Trader", weight: 100, reqTokens: 66666, trackedAnnualYieldUsd: 5447.10 },
    { tier: "T1", name: "Analyst", weight: 125, reqTokens: 166666, trackedAnnualYieldUsd: 6808.87 },
    { tier: "T2", name: "Portfolio Manager", weight: 160, reqTokens: 366666, trackedAnnualYieldUsd: 8715.36 },
    { tier: "T3", name: "Managing Director", weight: 200, reqTokens: 666666, trackedAnnualYieldUsd: 10894.20 },
    { tier: "T4", name: "Partner", weight: 333, reqTokens: 1666666, trackedAnnualYieldUsd: 18138.84 }
  ];

  const payload = {
    market: marketData,
    activation: activationMetrics,
    tiers: tiersData,
    lastUpdated: marketData.lastUpdated
  };

  fs.writeFileSync("data.json", JSON.stringify(payload, null, 2));
  console.log("Successfully generated staging data.json!");
}

runFetcher().catch(console.error);
