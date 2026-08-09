async function getGlobalYield(sevenDaysAgo, activationStats) {
  console.log("Fetching Global Yield...");
  let totalErc20Usd = 0;
  let oracleEthInflow = 0;

  // The On-Chain Oracle Wallet (Your T4 Partner TBA)
  const ORACLE_WALLET = "0xe7207caa913b54aa4411e847a3a49eee0568cccf".toLowerCase();
  const ORACLE_WEIGHT = 333; // T4 Partner Weight

  console.log("1. Tracking Native ETH via On-Chain Oracle (Bypassing L2 Indexer Bug)...");
  let pageEth = 1;
  while(true) {
      // Querying internal txs TO the Oracle Wallet
      const urlEth = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlistinternal&address=${ORACLE_WALLET}&page=${pageEth}&offset=1000&sort=desc&apikey=${API_KEY}`;
      const dataEth = await secureFetch(urlEth);
      const txs = Array.isArray(dataEth.result) ? dataEth.result : [];
      if(txs.length === 0) break;
      
      let reachedOlder = false;
      for (const tx of txs) {
        if (parseInt(tx.timeStamp) < sevenDaysAgo) {
          reachedOlder = true;
          continue;
        }
        if (tx.isError === "1") continue;
        
        // Sum all Native ETH deposited into the Oracle wallet
        if ((tx.to || "").toLowerCase() === ORACLE_WALLET) {
          const eth = Number(tx.value || 0) / 1e18;
          if (eth > 0) oracleEthInflow += eth;
        }
      }
      
      if(reachedOlder || txs.length < 1000) break;
      pageEth++;
      await sleep(300);
  }

  // Extrapolate Global ETH from Oracle
  let totalNetworkWeight = 0;
  for (const t of tierStructure) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }
  
  const globalEthYield = (oracleEthInflow / ORACLE_WEIGHT) * totalNetworkWeight;
  const globalEthUsd = globalEthYield * market.ethPriceUsd;

  console.log(`  Oracle 7D ETH: ${oracleEthInflow.toFixed(4)} ETH`);
  console.log(`  Extrapolated Global 7D ETH: ${globalEthYield.toFixed(2)} ETH ($${globalEthUsd.toFixed(2)})`);

  console.log("2. Tracking ERC-20 Outflows from Protocol Contracts...");
  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    for (const tokenAddr of Object.keys(TOKEN_TICKERS)) {
      const price = prices[tokenAddr] || 0;
      if (price <= 0) continue;
      
      let pageTok = 1;
      while(true) {
          const urlTok = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokentx&address=${pAddr}&contractaddress=${tokenAddr}&page=${pageTok}&offset=1000&sort=desc&apikey=${API_KEY}`;
          const dataTok = await secureFetch(urlTok);
          const txs = Array.isArray(dataTok.result) ? dataTok.result : [];
          if(txs.length === 0) break;

          let reachedOlder = false;
          for (const tx of txs) {
            if (parseInt(tx.timeStamp) < sevenDaysAgo) {
              reachedOlder = true;
              continue;
            }
            if (tx.isError === "1") continue;

            if ((tx.from || "").toLowerCase() === pL || (tx.to || "").toLowerCase() !== pL) {
              const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal, 10) : 18;
              const amount = Number(tx.value || 0) / Math.pow(10, decimals);
              if (amount > 0) totalErc20Usd += amount * price;
            }
          }
          
          if(reachedOlder || txs.length < 1000) break;
          pageTok++;
          await sleep(300);
      }
    }
  }

  console.log(`  Global 7D ERC-20 Yield: $${totalErc20Usd.toFixed(2)}`);
  return globalEthUsd + totalErc20Usd;
}

async function run() {
  console.log("Starting Dashboard Build...");
  await loadPrices();

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;

  const activationStats = await fetchActivations();
  // Pass activationStats to our new yield function
  const global7DayYield = await getGlobalYield(sevenDaysAgo, activationStats);
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
