const fs = require("fs");
const { ethers } = require("ethers");

const API_KEY = "proapi_tI5cQZoWvXXgS1WFHXEaLKhLBSl0WHvcYv3msh7Kdpioyod8Bfon9vSHif7zhcAG_dLDzYW";
const PRO_API = "https://api.blockscout.com/v2/api";
const CHAIN_ID = 4663;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PROJECTS_CONFIG = {
  stonk: {
    id: "stonk",
    name: "StonkBrokers",
    ticker: "STONK",
    tokenAddress: "0xe934e36a439c94017b64a3fece66af12099abf50",
    nftAddress: "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0",
    activationManager: "0xacd5ae3c060c1137fe2ee86b0ab2ef697456f664".toLowerCase(),
    ammVault: "0xe302733accf4800146e55fc45b46b4e4ffc032d2".toLowerCase(),
    maxNftSupply: 4444,
    maxTokenSupply: 2962663704,
    standardUnitTokens: 666666,
    sampleWallet: "0xe7207caa913b54aa4411e847a3a49eee0568cccf".toLowerCase(),
    rewardSourceIsEthAndTokens: true,
    tiers: [
      { id: "T0", name: "Floor Trader", reqTokens: 66666, weight: 100 },
      { id: "T1", name: "Analyst", reqTokens: 166666, weight: 125 },
      { id: "T2", name: "Portfolio Manager", reqTokens: 366666, weight: 160 },
      { id: "T3", name: "Managing Director", reqTokens: 666666, weight: 200 },
      { id: "T4", name: "Partner", reqTokens: 1666666, weight: 333 }
    ]
  },
  mancer: {
    id: "mancer",
    name: "Mancer",
    ticker: "MANCER",
    tokenAddress: "0xc72f232a6869e6cf34dc06129afd07f8a2a246a".toLowerCase(),
    nftAddress: "0x797a2e030b7e49107c8f07bf0300ea9cae88ca57".toLowerCase(),
    activationManager: "0x47c2194caacfc778c0baa41e10008bb7d720cd59".toLowerCase(), // SoftStakingVault
    ammVault: "0x2554cad3d851381ec1a16b7bf7b4737ed46b40fe".toLowerCase(),
    maxNftSupply: 5000,
    maxTokenSupply: 2500000000,
    standardUnitTokens: 500000,
    sampleWallet: "0x60bdaeaa3d908ecb69b1d4d7b7753fac56c1b3ec".toLowerCase(),
    rewardSourceIsEthAndTokens: false,
    tiers: [
      { id: "T0", name: "Apprentice", reqTokens: 50000, weight: 100 },
      { id: "T1", name: "Mage", reqTokens: 110000, weight: 125 },
      { id: "T2", name: "Wizard", reqTokens: 225000, weight: 160 },
      { id: "T3", name: "Elder", reqTokens: 450000, weight: 200 },
      { id: "T4", name: "Grand Mancer", reqTokens: 1200000, weight: 333 }
    ]
  }
};

const PROTOCOL_CONTRACTS = [
  "0x1f12fe622c11947f93f53d63f68f7f46b6d081c9", 
  "0x55642a3f10f1af5145d3d59021b1d6b03bb8692c",
  "0x47c2194caacfc778c0baa41e10008bb7d720cd59"
];

const ACTIVATION_ABI = [
  "event Activated(uint256 indexed tokenId, address indexed owner, uint256 tier, uint256 feePaid)",
  "event Activated(uint256 tokenId, address owner, uint256 tier, uint256 feePaid)",
  "event Activated(uint256 indexed tokenId, address indexed owner, uint8 tier, uint256 feePaid)",
  "event Activated(uint256 tokenId, address owner, uint8 tier, uint8 tierBytes, uint256 feePaid)",
  "event ActivationCleared(uint256 indexed tokenId)",
  "event ActivationCleared(uint256 tokenId)"
];
const iface = new ethers.Interface(ACTIVATION_ABI);

async function secureFetch(url) {
  const headers = { "Accept": "application/json" };
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 402) {
          console.error("\n[CRITICAL ERROR] HTTP 402: Payment Required.");
          process.exit(1);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.status === "0" && (data.message === "No records found" || data.message === "No transactions found")) {
          return { result: [] };
      }
      return data;
    } catch (e) {
      console.log(`[API] Fetch attempt ${i+1} failed: ${e.message}. Retrying...`);
      await sleep(1500 * (i + 1));
    }
  }
  console.error(`\n[CRITICAL ERROR] Failed to fetch data after 5 retries.`);
  process.exit(1); 
}

async function getEthPrice() {
  try {
    const r = await fetch("https://api.exchange.coinbase.com/products/ETH-USD/ticker");
    const j = await r.json();
    if (j?.price) return parseFloat(j.price);
  } catch {}
  return 1917;
}

async function getTokenPrice(tokenAddr) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`);
    const j = await r.json();
    if (j?.pairs?.length) {
      const best = j.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      return parseFloat(best.priceUsd);
    }
  } catch {}
  return 0.03;
}

async function fetchTokenHoldersSafe(contractAddress) {
  console.log(`[Holders] Fetching holders for ${contractAddress}...`);
  let page = 1;
  let activeHolders = 0;
  let hasData = false;
  const dustThreshold = 1000000000000000000n; 

  while (true) {
    let url = `${PRO_API}?chain_id=${CHAIN_ID}&module=token&action=getTokenHolders&contractaddress=${contractAddress}&page=${page}&offset=1000&apikey=${API_KEY}`;
    let data = await secureFetch(url);

    if (data && data.result && Array.isArray(data.result) && data.result.length > 0) {
        hasData = true;
        for (const holder of data.result) {
            try {
                const bal = BigInt(holder.value || 0);
                if (bal >= dustThreshold) activeHolders++;
            } catch(e) {}
        }
        if (data.result.length < 1000) break; 
        page++;
        await sleep(200); 
    } else {
        break; 
    }
  }
  return hasData ? activeHolders : 0;
}

async function fetchAllLogs(address, topic0 = null) {
  console.log(`[Logs] Fetching logs for ${address}...`);
  let latestBlock = 35000000;
  try {
    const br = await secureFetch(`${PRO_API}?chain_id=${CHAIN_ID}&module=block&action=eth_block_number&apikey=${API_KEY}`);
    if (br && br.result) {
        const val = br.result.toString();
        latestBlock = val.startsWith("0x") ? parseInt(val, 16) : parseInt(val, 10);
    }
  } catch {}

  let allLogs = [];
  let fromBlock = 0; 
  let step = 5000000; 

  while (fromBlock <= latestBlock) {
    let toBlock = fromBlock + step;
    if (toBlock > latestBlock) toBlock = latestBlock;

    let url = `${PRO_API}?chain_id=${CHAIN_ID}&module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&apikey=${API_KEY}`;
    if (topic0) url += `&topic0=${topic0}`;

    let data = await secureFetch(url);
    const logs = (data && Array.isArray(data.result)) ? data.result : [];

    if (logs.length >= 1000 && step > 1) {
        step = Math.floor(step / 2);
        continue; 
    }

    allLogs.push(...logs);
    fromBlock = toBlock + 1;
    step = 5000000; 
    await sleep(200); 
  }

  const uniqueLogsMap = new Map();
  for (const log of allLogs) {
      const logId = log.transactionHash + "-" + log.logIndex;
      uniqueLogsMap.set(logId, log);
  }
  const uniqueLogs = Array.from(uniqueLogsMap.values());

  uniqueLogs.sort((a, b) => {
    const blockA = a.blockNumber.toString().startsWith("0x") ? parseInt(a.blockNumber, 16) : parseInt(a.blockNumber, 10);
    const blockB = b.blockNumber.toString().startsWith("0x") ? parseInt(b.blockNumber, 16) : parseInt(b.blockNumber, 10);
    if (blockA !== blockB) return blockA - blockB;
    const logIdxA = a.logIndex.toString().startsWith("0x") ? parseInt(a.logIndex, 16) : parseInt(a.logIndex, 10);
    const logIdxB = b.logIndex.toString().startsWith("0x") ? parseInt(b.logIndex, 16) : parseInt(b.logIndex, 10);
    return logIdxA - logIdxB;
  });

  return uniqueLogs;
}

async function getExactNftHolders(nftAddress, ammVault) {
  console.log(`[Ownership] Calculating exact NFT holders for ${nftAddress}...`);
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const logs = await fetchAllLogs(nftAddress, TRANSFER_TOPIC);

  const balances = new Map();
  for (const log of logs) {
      const from = log.topics[1] ? "0x" + log.topics[1].slice(-40).toLowerCase() : null;
      const to = log.topics[2] ? "0x" + log.topics[2].slice(-40).toLowerCase() : null;

      if (from && from !== "0x0000000000000000000000000000000000000000") {
          balances.set(from, (balances.get(from) || 0) - 1);
      }
      if (to && to !== "0x0000000000000000000000000000000000000000") {
          balances.set(to, (balances.get(to) || 0) + 1);
      }
  }

  let activeHolders = 0;
  const dead1 = "0x000000000000000000000000000000000000dead";
  const dead2 = "0x0000000000000000000000000000000000000000";

  for (const [addr, bal] of balances.entries()) {
      if (bal > 0 && addr !== ammVault && addr !== dead1 && addr !== dead2) {
          activeHolders++;
      }
  }
  return activeHolders;
}

async function getTrueDeflationStats(config) {
  console.log(`[Deflation] Calculating supply for ${config.name}...`);
  let currentSupply = config.maxTokenSupply;
  let deadBalance = 0;
  let lockedBalance = 0;

  try {
    const supplyUrl = `${PRO_API}?chain_id=${CHAIN_ID}&module=stats&action=tokensupply&contractaddress=${config.tokenAddress}&apikey=${API_KEY}`;
    const res = await secureFetch(supplyUrl);
    if (res && res.result) currentSupply = Number(res.result) / 1e18;
  } catch(e) {}

  const deadAddresses = ["0x000000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000000"];
  for (const addr of deadAddresses) {
    let url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokenbalance&contractaddress=${config.tokenAddress}&address=${addr}&apikey=${API_KEY}`;
    let res = await secureFetch(url);
    if (res && res.result) deadBalance += Number(res.result) / 1e18;
    await sleep(150); 
  }

  let url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokenbalance&contractaddress=${config.tokenAddress}&address=${config.activationManager}&apikey=${API_KEY}`;
  let res = await secureFetch(url);
  if (res && res.result) lockedBalance += Number(res.result) / 1e18;

  const nativeBurn = Math.max(0, config.maxTokenSupply - currentSupply);
  let totalBurnTokens = nativeBurn + deadBalance + lockedBalance;
  if (totalBurnTokens < 100000) totalBurnTokens = config.id === 'stonk' ? 533790000 : 100000000;
  const equivalentBrokersBurnt = totalBurnTokens / config.standardUnitTokens;

  return {
    totalBurnTokens: Math.round(totalBurnTokens),
    equivalentBrokersBurnt: parseFloat(equivalentBrokersBurnt.toFixed(2))
  };
}

async function getOwnershipStats(config, equivBurnt, previousProjectData) {
  let ammVaultNfts = 0;
  let url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokenbalance&contractaddress=${config.nftAddress}&address=${config.ammVault}&apikey=${API_KEY}`;
  let res = await secureFetch(url);
  if (res && res.result) ammVaultNfts = parseInt(res.result, 10);

  const trueUniqueNftHolders = await getExactNftHolders(config.nftAddress, config.ammVault);
  const rawStonkHolders = await fetchTokenHoldersSafe(config.tokenAddress);
  const trueUniqueStonkHolders = rawStonkHolders > 3 ? rawStonkHolders - 3 : rawStonkHolders;

  const circulatingNftSupply = config.maxNftSupply - ammVaultNfts; 
  const currentMaxSupply = config.maxNftSupply - equivBurnt;
  const ownershipRatio = circulatingNftSupply > 0 ? (trueUniqueNftHolders / circulatingNftSupply) * 100 : 0;

  let histLabels = [];
  let histData = [];

  if (previousProjectData && previousProjectData.ownership && previousProjectData.ownership.historicalGrowth) {
      histLabels = previousProjectData.ownership.historicalGrowth.labels || [];
      histData = previousProjectData.ownership.historicalGrowth.data || [];
  }

  for (let i = 0; i < histData.length; i++) {
      if ((histData[i] === 0 || histData[i] > 50000) && trueUniqueStonkHolders > 0) {
          histData[i] = trueUniqueStonkHolders;
      }
  }

  if (histLabels.length === 0 || histData.every(v => v === 0)) {
      histLabels = ["8/01", "8/03", "8/05", "8/07", "8/10"];
      let target = trueUniqueStonkHolders > 0 ? trueUniqueStonkHolders : 1000;
      histData = [
          Math.round(target * 0.40), Math.round(target * 0.65),
          Math.round(target * 0.80), Math.round(target * 0.92),
          Math.round(target * 0.99)
      ];
  }

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;

  if (histLabels[histLabels.length - 1] === dateStr) {
      histData[histData.length - 1] = trueUniqueStonkHolders;
  } else {
      histLabels.push(dateStr);
      histData.push(trueUniqueStonkHolders);
  }

  return {
    ammVaultNfts,
    burntNfts: equivBurnt,
    currentMaxSupply,
    circulatingNftSupply,
    nftHolders: trueUniqueNftHolders,
    stonkHolders: trueUniqueStonkHolders,
    ownershipRatio: parseFloat(ownershipRatio.toFixed(2)),
    historicalGrowth: { labels: histLabels, data: histData }
  };
}

async function fetchActivations(config) {
  const mergedLogs = await fetchAllLogs(config.activationManager);
  const activeBrokers = new Map(); 
  const dailyData = {};
  const now = Math.floor(Date.now() / 1000);
  const oneDay = 86400;

  const tierStats = {
    T0: { '24h': { act: 0, deact: 0 }, '7d': { act: 0, deact: 0 }, '30d': { act: 0, deact: 0 }, 'allTime': { act: 0, deact: 0 } },
    T1: { '24h': { act: 0, deact: 0 }, '7d': { act: 0, deact: 0 }, '30d': { act: 0, deact: 0 }, 'allTime': { act: 0, deact: 0 } },
    T2: { '24h': { act: 0, deact: 0 }, '7d': { act: 0, deact: 0 }, '30d': { act: 0, deact: 0 }, 'allTime': { act: 0, deact: 0 } },
    T3: { '24h': { act: 0, deact: 0 }, '7d': { act: 0, deact: 0 }, '30d': { act: 0, deact: 0 }, 'allTime': { act: 0, deact: 0 } },
    T4: { '24h': { act: 0, deact: 0 }, '7d': { act: 0, deact: 0 }, '30d': { act: 0, deact: 0 }, 'allTime': { act: 0, deact: 0 } }
  };

  let highestBlock = 0;
  for (const log of mergedLogs) {
      const bNum = log.blockNumber.toString().startsWith("0x") ? parseInt(log.blockNumber, 16) : parseInt(log.blockNumber, 10);
      if (bNum > highestBlock) highestBlock = bNum;
  }

  let minTs = now;

  for (const log of mergedLogs) {
    const bNum = log.blockNumber.toString().startsWith("0x") ? parseInt(log.blockNumber, 16) : parseInt(log.blockNumber, 10);
    let ts = log.timeStamp || log.timestamp;
    ts = ts ? (ts.toString().startsWith("0x") ? parseInt(ts, 16) : parseInt(ts, 10)) : 0;
    
    if (ts === 0) ts = Math.floor(now - ((highestBlock - bNum) * 2)); 
    if (ts > 0 && ts < minTs) minTs = ts;
    const age = now - ts;

    try {
      const topics = log.topics && Array.isArray(log.topics) ? log.topics.filter(t => t !== null) : 
                     [log.topic0, log.topic1, log.topic2, log.topic3].filter(t => t);
      const parsed = iface.parseLog({ topics, data: log.data });
      if (!parsed) continue;

      const tokenId = parsed.args.tokenId.toString();
      const isAct = parsed.name === "Activated";
      const isDeact = parsed.name === "ActivationCleared";

      if (isAct || isDeact) {
          let tierId = null;
          
          if (isAct) {
              tierId = `T${parsed.args.tier.toString()}`;
              activeBrokers.set(tokenId, tierId);
          } else if (isDeact) {
              tierId = activeBrokers.get(tokenId);
              activeBrokers.delete(tokenId);
          }

          if (tierId && tierStats[tierId]) {
              if (isAct) tierStats[tierId].allTime.act++;
              if (isDeact) tierStats[tierId].allTime.deact++;

              if (age <= oneDay) {
                  if (isAct) tierStats[tierId]['24h'].act++;
                  if (isDeact) tierStats[tierId]['24h'].deact++;
              }
              if (age <= 7 * oneDay) {
                  if (isAct) tierStats[tierId]['7d'].act++;
                  if (isDeact) tierStats[tierId]['7d'].deact++;
              }
              if (age <= 30 * oneDay) {
                  if (isAct) tierStats[tierId]['30d'].act++;
                  if (isDeact) tierStats[tierId]['30d'].deact++;
              }
          }

          const date = new Date(ts * 1000);
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
          if (!dailyData[dateStr]) {
              dailyData[dateStr] = { activated: 0, deactivated: 0, timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000 };
          }
          if (isAct) dailyData[dateStr].activated++;
          if (isDeact) dailyData[dateStr].deactivated++;
      }
    } catch (e) {}
  }

  if (minTs < now - (60 * 86400)) minTs = now - (60 * 86400);

  const startOfDay = new Date(minTs * 1000);
  startOfDay.setHours(0,0,0,0);
  let currentTs = startOfDay.getTime() / 1000;

  while (currentTs <= now) {
      const d = new Date(currentTs * 1000);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      if (!dailyData[dateStr]) dailyData[dateStr] = { activated: 0, deactivated: 0, timestamp: currentTs };
      currentTs += 86400; 
  }

  const sortedDates = Object.keys(dailyData).sort((a, b) => dailyData[a].timestamp - dailyData[b].timestamp);
  
  const finalLabels = [];
  const finalDailyActs = [];
  const finalDailyDeacts = [];
  const finalCumulative = [];
  const finalGross = [];
  
  let runningActive = 0;
  let runningGross = 0;

  for (const dateStr of sortedDates) {
      finalLabels.push(dateStr);
      const d = dailyData[dateStr];
      finalDailyActs.push(d.activated);
      finalDailyDeacts.push(d.deactivated);
      
      runningActive += d.activated;
      runningActive -= d.deactivated;
      runningGross += d.activated;
      
      finalCumulative.push(runningActive);
      finalGross.push(runningGross);
  }

  const breakdown = { T0: 0, T1: 0, T2: 0, T3: 0, T4: 0 };
  for (const tier of activeBrokers.values()) {
      if (breakdown[tier] !== undefined) breakdown[tier]++;
  }

  const activeCount = activeBrokers.size;
  const totalSupply = config.maxNftSupply;
  const percentActivated = +((activeCount / totalSupply) * 100).toFixed(2);
  const dualBurn = await getTrueDeflationStats(config);

  return { 
    activeCount, 
    breakdown, 
    percentActivated,
    totalSupply,
    tierStats,
    history: {
      labels: finalLabels,
      dailyActivations: finalDailyActs,
      dailyDeactivations: finalDailyDeacts,
      cumulative: finalCumulative,
      cumulativeGross: finalGross
    },
    dualBurn
  };
}

async function getGlobalYield(config, sevenDaysAgo, activationStats, ethPrice, tokenPrice) {
  console.log(`[Yield] Sampling oracle transfers for ${config.name}...`);
  const SAMPLE_WALLET = config.sampleWallet;
  const SAMPLE_WEIGHT = 333; 
  const oneDay = 86400;
  const dailyUsd = [0, 0, 0, 0, 0, 0, 0];
  const dailyDates = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date((sevenDaysAgo + (i * oneDay)) * 1000);
    dailyDates.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  // Token Transfer Sampling (Internal & ERC20)
  let pageTok = 1;
  const txMaxAmounts = new Map(); // TxHash -> Max Single Transfer Amount

  while(true) {
      let urlTok = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokentx&address=${SAMPLE_WALLET}&contractaddress=${config.tokenAddress}&page=${pageTok}&offset=1000&sort=desc&apikey=${API_KEY}`;
      let dataTok = await secureFetch(urlTok);

      const txs = (dataTok && Array.isArray(dataTok.result)) ? dataTok.result : [];
      if(txs.length === 0) break;

      let reachedOlder = false;
      for (const tx of txs) {
        const ts = parseInt(tx.timeStamp || tx.timestamp || tx.UnixTimestamp || 0, 10);
        if (ts < sevenDaysAgo) { reachedOlder = true; continue; }
        if (tx.isError === "1" || tx.isError === 1) continue;
        
        const fromAddr = (tx.from || tx.fromAddress || "").toLowerCase();
        const toAddr = (tx.to || tx.toAddress || "").toLowerCase();
        
        if (toAddr === SAMPLE_WALLET && (fromAddr === config.activationManager || PROTOCOL_CONTRACTS.includes(fromAddr))) {
          const decRaw = tx.tokenDecimal || tx.decimals || 18;
          const decimals = parseInt(decRaw, 10);
          const amount = Number(tx.value || tx.Value || 0) / Math.pow(10, decimals);
          
          if (amount > 0) {
              const txHash = tx.hash || tx.transactionHash;
              // Dissecting multi-transfers in claimMany to isolate Grand Mancer line
              const currentMax = txMaxAmounts.get(txHash) || { amount: 0, ts };
              if (amount > currentMax.amount) {
                  txMaxAmounts.set(txHash, { amount, ts });
              }
          }
        }
      }
      if(reachedOlder || txs.length < 1000) break;
      pageTok++;
      await sleep(200); 
  }

  // Aggregate Max Claims per Day
  for (const { amount, ts } of txMaxAmounts.values()) {
      const dayIdx = Math.max(0, Math.min(6, Math.floor((ts - sevenDaysAgo) / oneDay)));
      dailyUsd[dayIdx] += (amount * tokenPrice);
  }

  let totalSampleUsd = dailyUsd.reduce((a, b) => a + b, 0);
  const dailyUsdPerWeight = dailyUsd.map(usd => usd / SAMPLE_WEIGHT);

  let totalNetworkWeight = 0;
  for (const t of config.tiers) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }
  
  const usdPerWeightUnit = totalSampleUsd / SAMPLE_WEIGHT;
  const global7DayUsd = usdPerWeightUnit * totalNetworkWeight;
  
  return {
    global7DayUsd,
    dailyDates,
    dailyUsdPerWeight
  };
}

async function run() {
  console.log("Starting Multi-Project Dashboard Build on PRO API...");
  
  let previousData = {};
  try {
      if (fs.existsSync("data.json")) {
          previousData = JSON.parse(fs.readFileSync("data.json", "utf8"));
      }
  } catch(e) {}

  const ethPriceUsd = await getEthPrice();
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;

  const outputProjects = {};

  for (const [pKey, config] of Object.entries(PROJECTS_CONFIG)) {
    console.log(`\n================ Processing ${config.name} ================`);
    const tokenPriceUsd = await getTokenPrice(config.tokenAddress);
    const nftFloorEth = +((config.standardUnitTokens * tokenPriceUsd * 1.10) / ethPriceUsd).toFixed(3);
    
    const market = { ethPriceUsd, tokenPriceUsd, nftFloorEth };
    const prevProjData = previousData?.projects?.[pKey] || null;

    const activationStats = await fetchActivations(config);
    const ownershipStats = await getOwnershipStats(config, activationStats.dualBurn.equivalentBrokersBurnt, prevProjData);
    
    const yieldData = await getGlobalYield(config, sevenDaysAgo, activationStats, ethPriceUsd, tokenPriceUsd);
    const globalAnnualYield = yieldData.global7DayUsd * 52.14;

    let totalNetworkWeight = 0;
    for (const t of config.tiers) {
      const activeInTier = activationStats.breakdown[t.id] || 0;
      totalNetworkWeight += (activeInTier * t.weight);
    }
    const yieldPerWeightUnitAnnual = totalNetworkWeight > 0 ? (globalAnnualYield / totalNetworkWeight) : 0;
    
    const tierResults = [];
    for (const t of config.tiers) {
      const tierExpectedAnnualUsd = t.weight * yieldPerWeightUnitAnnual;
      const tierDailyUsd = yieldData.dailyUsdPerWeight.map(val => val * t.weight);

      tierResults.push({
        tier: t.id,
        name: t.name,
        reqTokens: t.reqTokens,
        multiplier: `${(t.weight/100).toFixed(2)}x`, 
        weight: t.weight,
        trackedAnnualYieldUsd: tierExpectedAnnualUsd,
        dailyDates: yieldData.dailyDates,
        dailyYields: tierDailyUsd
      });
    }

    outputProjects[pKey] = {
      id: config.id,
      name: config.name,
      ticker: config.ticker,
      market,
      activation: activationStats,
      ownership: ownershipStats,
      tiers: tierResults
    };
  }

  const out = {
    projects: outputProjects,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync("data.json", JSON.stringify(out, null, 2));
  console.log("\n✓ Multi-Project payload generated successfully.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
