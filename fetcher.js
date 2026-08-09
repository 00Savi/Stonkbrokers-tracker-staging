const fs = require("fs");
const { ethers } = require("ethers");

const API_KEY = "proapi_tI5cQZoWvXXgS1WFHXEaLKhLBSl0WHvcYv3msh7Kdpioyod8Bfon9vSHif7zhcAG_dLDzYW";
const PRO_API = "https://api.blockscout.com/v2/api";
const CHAIN_ID = 4663;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ACTIVATION_MANAGER = "0xacd5ae3c060c1137fe2ee86b0ab2ef697456f664".toLowerCase();
const NFT_CONTRACT = "0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0".toLowerCase();

// The core distribution/fee contracts receiving the Top-Line ETH Revenue
const PROTOCOL_CONTRACTS = [
  "0x1f12fe622c11947f93f53d63f68f7f46b6d081c9", // DIRECTED CLOCK IN BOOSTER / CLOCK IN V2
  "0x55642a3f10f1af5145d3d59021b1d6b03bb8692c"  // SAFETY DEPOSIT CLOCK IN (FEE ROUTER)
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

let market = { ethPriceUsd: 1917, tokenPriceUsd: 0.0308, nftFloorEth: 11.77 };

const tierStructure = [
  { id: "T0", name: "Floor Trader", reqTokens: 66666, weight: 100 },
  { id: "T1", name: "Analyst", reqTokens: 166666, weight: 125 },
  { id: "T2", name: "Portfolio Manager", reqTokens: 366666, weight: 160 },
  { id: "T3", name: "Managing Director", reqTokens: 666666, weight: 200 },
  { id: "T4", name: "Partner", reqTokens: 1666666, weight: 333 }
];

async function secureFetch(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "StonkBrokersTracker/5.0" } });
      if (res.status === 429) throw new Error("rate");
      return await res.json();
    } catch (e) {
      await sleep(2000 + i * 1500);
    }
  }
  return { result: [] };
}

async function loadPrices() {
  try {
    const r = await fetch("https://api.exchange.coinbase.com/products/ETH-USD/ticker");
    const j = await r.json();
    if (j?.price) market.ethPriceUsd = parseFloat(j.price);
  } catch {}

  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/0xe934e36a439c94017b64a3fece66af12099abf50");
    const j = await r.json();
    if (j?.pairs?.length) {
      const best = j.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      market.tokenPriceUsd = parseFloat(best.priceUsd);
    }
  } catch {}

  market.nftFloorEth = +((666666 * market.tokenPriceUsd * 1.10) / market.ethPriceUsd).toFixed(3);
}

// OMITTED: getBurnEvents() and fetchActivations() remain exactly the same as your previous working version
// To keep this snippet clean, ensure you paste your existing fetchActivations() and getBurnEvents() functions here.
async function getBurnEvents() {
  console.log("Fetching NFT burn events...");
  const burnEvents = [];
  const deadAddresses = [
    "0x000000000000000000000000000000000000dead",
    "0x0000000000000000000000000000000000000000"
  ];
  
  for (const addr of deadAddresses) {
    let page = 1;
    while(true) {
      const url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokennfttx&contractaddress=${NFT_CONTRACT}&address=${addr}&page=${page}&offset=1000&sort=asc&apikey=${API_KEY}`;
      const data = await secureFetch(url);
      const txs = Array.isArray(data.result) ? data.result : [];
      if (txs.length === 0) break;
      
      for (const tx of txs) {
        if ((tx.to || "").toLowerCase() === addr) {
           burnEvents.push({
              isBurn: true,
              blockNumber: tx.blockNumber,
              logIndex: (parseInt(tx.transactionIndex || 0, 10) * 1000).toString(), 
              timeStamp: tx.timeStamp,
              tokenId: tx.tokenID
           });
        }
      }
      if (txs.length < 1000) break;
      page++;
      await sleep(250);
    }
  }
  return burnEvents;
}

async function fetchActivations() {
  console.log("Fetching activation logs via Dynamic Block Pointer...");
  let allLogs = [];
  
  let latestBlock = 35000000;
  try {
    const br = await secureFetch(`${PRO_API}?chain_id=${CHAIN_ID}&module=block&action=eth_block_number&apikey=${API_KEY}`);
    if (br.result) {
      latestBlock = br.result.toString().startsWith("0x") ? parseInt(br.result, 16) : parseInt(br.result, 10);
    }
  } catch {}

  let currentBlock = 0;
  let seenLogs = new Set(); 

  while (currentBlock <= latestBlock) {
    const url = `${PRO_API}?chain_id=${CHAIN_ID}&module=logs&action=getLogs&address=${ACTIVATION_MANAGER}&fromBlock=${currentBlock}&toBlock=latest&apikey=${API_KEY}`;
    const data = await secureFetch(url);
    const logs = Array.isArray(data.result) ? data.result : [];
    
    if (logs.length === 0) break;
    
    let lastBlockInChunk = currentBlock;

    for (const log of logs) {
      const logId = log.transactionHash + "-" + log.logIndex;
      if (!seenLogs.has(logId)) {
        seenLogs.add(logId);
        allLogs.push(log);
      }
      const bNum = log.blockNumber.toString().startsWith("0x") ? parseInt(log.blockNumber, 16) : parseInt(log.blockNumber, 10);
      if (bNum > lastBlockInChunk) lastBlockInChunk = bNum;
    }

    if (logs.length < 1000) {
      break; 
    } else {
      currentBlock = lastBlockInChunk === currentBlock ? currentBlock + 1 : lastBlockInChunk;
    }
    await sleep(300);
  }

  const burnEvents = await getBurnEvents();
  if (burnEvents.length > 0) {
    allLogs.push(...burnEvents);
  }

  allLogs.sort((a, b) => {
    const blockA = a.blockNumber.toString().startsWith("0x") ? parseInt(a.blockNumber, 16) : parseInt(a.blockNumber, 10);
    const blockB = b.blockNumber.toString().startsWith("0x") ? parseInt(b.blockNumber, 16) : parseInt(b.blockNumber, 10);
    if (blockA !== blockB) return blockA - blockB;
    
    const logIdxA = a.logIndex.toString().startsWith("0x") ? parseInt(a.logIndex, 16) : parseInt(a.logIndex, 10);
    const logIdxB = b.logIndex.toString().startsWith("0x") ? parseInt(b.logIndex, 16) : parseInt(b.logIndex, 10);
    return logIdxA - logIdxB;
  });

  const activeBrokers = new Map(); 
  const historyMap = new Map(); 
  let totalBroken = 0;

  for (const log of allLogs) {
    if (log.isBurn) {
        const tokenId = log.tokenId.toString();
        if (activeBrokers.has(tokenId)) {
            activeBrokers.delete(tokenId);
            totalBroken++;
            const timeStampVal = parseInt(log.timeStamp, 10);
            const dayKey = new Date(timeStampVal * 1000).setUTCHours(0,0,0,0);
            historyMap.set(dayKey, activeBrokers.size);
        }
        continue;
    }

    try {
      const topics = [];
      if (log.topics && Array.isArray(log.topics)) {
         topics.push(...log.topics.filter(t => t !== null));
      } else {
         if (log.topic0) topics.push(log.topic0);
         if (log.topic1) topics.push(log.topic1);
         if (log.topic2) topics.push(log.topic2);
         if (log.topic3) topics.push(log.topic3);
      }

      const parsed = iface.parseLog({ topics, data: log.data });
      if (!parsed) continue;

      const timeStampVal = log.timeStamp.toString().startsWith("0x") ? parseInt(log.timeStamp, 16) : parseInt(log.timeStamp, 10);
      const dayKey = new Date(timeStampVal * 1000).setUTCHours(0,0,0,0);
      const tokenId = parsed.args.tokenId.toString();

      if (parsed.name === "Activated") {
        const rawTier = parsed.args.tier.toString();
        activeBrokers.set(tokenId, `T${rawTier}`);
      } else if (parsed.name === "ActivationCleared") {
        totalBroken++;
        activeBrokers.delete(tokenId);
      }

      historyMap.set(dayKey, activeBrokers.size);
    } catch (e) {}
  }

  const breakdown = { T0: 0, T1: 0, T2: 0, T3: 0, T4: 0 };
  for (const tier of activeBrokers.values()) {
    if (breakdown[tier] !== undefined) breakdown[tier]++;
  }

  const sortedDays = Array.from(historyMap.keys()).sort((a, b) => a - b);
  const labels = [];
  const cumulative = [];

  if (sortedDays.length > 0) {
    const firstDay = sortedDays[0];
    const today = new Date().setUTCHours(0,0,0,0);
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (let d = firstDay; d <= today; d += ONE_DAY) {
      const dateObj = new Date(d);
      labels.push(`${dateObj.getUTCMonth()+1}/${dateObj.getUTCDate()}/${dateObj.getUTCFullYear().toString().slice(-2)}`);
      
      let historicalCount = 0;
      let closestTime = 0;
      for (const [time, count] of historyMap.entries()) {
        if (time <= d && time > closestTime) {
           closestTime = time;
           historicalCount = count;
        }
      }
      cumulative.push(historicalCount);
    }
  }

  const activeCount = activeBrokers.size;
  const uniqueBurned = new Set(burnEvents.map(b => b.tokenId));
  const circulatingSupply = 4444 - uniqueBurned.size;

  return { 
    activeCount, 
    totalSupply: circulatingSupply, 
    percentActivated: +((activeCount / circulatingSupply) * 100).toFixed(2), 
    breakdown, 
    history: { labels, cumulative } 
  };
}

async function getGlobalYield(sevenDaysAgo) {
  console.log("Fetching Top-Line Gross ETH Inflow (Path A)...");
  let totalEthInflow = 0;

  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    let page = 1;
    while(true) {
        // Querying NORMAL transactions (action=txlist) moving ETH into the protocol
        const url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlist&address=${pAddr}&page=${page}&offset=1000&sort=desc&apikey=${API_KEY}`;
        const data = await secureFetch(url);
        const txs = Array.isArray(data.result) ? data.result : [];
        if (txs.length === 0) break;
        
        let reachedOlder = false;
        for (const tx of txs) {
          const ts = parseInt(tx.timeStamp || 0, 10);
          if (ts < sevenDaysAgo) {
            reachedOlder = true;
            continue;
          }
          if (tx.isError === "1") continue;
          
          // Capture Native ETH deposited TO the protocol
          if ((tx.to || "").toLowerCase() === pL) {
            const eth = Number(tx.value || 0) / 1e18;
            if (eth > 0) {
              totalEthInflow += eth;
            }
          }
        }
        
        if (reachedOlder || txs.length < 1000) break;
        page++;
        await sleep(300);
    }
  }

  console.log(`  Total 7-Day Top-Line Protocol Revenue: ${totalEthInflow.toFixed(4)} ETH`);
  
  // Convert Total Gross ETH directly to USD using live market price
  const totalUsd = totalEthInflow * market.ethPriceUsd;
  return totalUsd;
}

async function run() {
  console.log("Starting Dashboard Build...");
  await loadPrices();

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;

  const activationStats = await fetchActivations();
  const global7DayYield = await getGlobalYield(sevenDaysAgo);
  const globalAnnualYield = global7DayYield * 52.14;

  let totalNetworkWeight = 0;
  for (const t of tierStructure) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }

  const yieldPerWeightUnitAnnual = totalNetworkWeight > 0 ? (globalAnnualYield / totalNetworkWeight) : 0;
  
  const results = [];
  for (const t of tierStructure) {
    const tierExpectedAnnualUsd = t.weight * yieldPerWeightUnitAnnual;
    results.push({
      tier: t.id,
      name: t.name,
      reqTokens: t.reqTokens,
      multiplier: `${(t.weight/100).toFixed(2)}x`, 
      weight: t.weight,
      trackedAnnualYieldUsd: tierExpectedAnnualUsd
    });
  }

  const out = {
    market,
    activation: activationStats,
    tiers: results,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync("data.json", JSON.stringify(out, null, 2));
  console.log("\n✓ Dashboard data payload generated successfully.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
