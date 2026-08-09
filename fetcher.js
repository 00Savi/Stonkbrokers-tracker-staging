async function getGlobalYield(sevenDaysAgo, activationStats) {
  console.log("Fetching Yield via Dual-Capture T4 Oracle (Wallet Sampling)...");
  
  const SAMPLE_WALLET = "0xe7207caa913b54aa4411e847a3a49eee0568cccf".toLowerCase();
  const SAMPLE_WEIGHT = 333; 

  let sampleEthInflow = 0;
  let sampleErc20Usd = 0;

  console.log("1. Tracking Native ETH deposited to Oracle Wallet...");
  let pageEth = 1;
  while(true) {
      const urlEth = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlistinternal&address=${SAMPLE_WALLET}&page=${pageEth}&offset=1000&sort=desc&apikey=${API_KEY}`;
      const dataEth = await secureFetch(urlEth);
      const txs = Array.isArray(dataEth.result) ? dataEth.result : [];
      if(txs.length === 0) break;
      
      let reachedOlder = false;
      for (const tx of txs) {
        const ts = parseInt(tx.timeStamp || 0, 10);
        if (ts < sevenDaysAgo) {
          reachedOlder = true;
          continue;
        }
        if (tx.isError === "1") continue;
        
        // Loosen JSON parsing to catch all possible Blockscout sender keys
        const fromAddr = (tx.from || tx.fromAddress || tx.contractAddress || "").toLowerCase();
        const toAddr = (tx.to || tx.toAddress || "").toLowerCase();
        
        if (PROTOCOL_CONTRACTS.includes(fromAddr) && toAddr === SAMPLE_WALLET) {
          const eth = Number(tx.value || 0) / 1e18;
          if (eth > 0) sampleEthInflow += eth;
        }
      }
      
      if(reachedOlder || txs.length < 1000) break;
      pageEth++;
      await sleep(300);
  }

  console.log(`  -> Oracle 7D ETH Captured: ${sampleEthInflow.toFixed(6)} ETH`);

  console.log("2. Tracking Tracked ERC-20 Tokens deposited to Oracle Wallet...");
  for (const tokenAddr of Object.keys(TOKEN_TICKERS)) {
    const price = prices[tokenAddr] || 0;
    if (price <= 0) continue;
    
    let pageTok = 1;
    while(true) {
        const urlTok = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokentx&address=${SAMPLE_WALLET}&contractaddress=${tokenAddr}&page=${pageTok}&offset=1000&sort=desc&apikey=${API_KEY}`;
        const dataTok = await secureFetch(urlTok);
        const txs = Array.isArray(dataTok.result) ? dataTok.result : [];
        if(txs.length === 0) break;

        let reachedOlder = false;
        for (const tx of txs) {
          const ts = parseInt(tx.timeStamp || 0, 10);
          if (ts < sevenDaysAgo) {
            reachedOlder = true;
            continue;
          }
          
          const fromAddr = (tx.from || tx.fromAddress || "").toLowerCase();
          const toAddr = (tx.to || tx.toAddress || "").toLowerCase();
          
          if (PROTOCOL_CONTRACTS.includes(fromAddr) && toAddr === SAMPLE_WALLET) {
            const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal, 10) : 18;
            const amount = Number(tx.value || 0) / Math.pow(10, decimals);
            if (amount > 0) sampleErc20Usd += (amount * price);
          }
        }
        
        if(reachedOlder || txs.length < 1000) break;
        pageTok++;
        await sleep(300);
    }
  }

  console.log(`  -> Oracle 7D ERC-20 Captured: $${sampleErc20Usd.toFixed(2)}`);

  const sampleEthUsd = sampleEthInflow * market.ethPriceUsd;
  const totalSampleUsd = sampleEthUsd + sampleErc20Usd;
  
  if (totalSampleUsd === 0) {
      console.log("WARNING: Zero yield tracked. Check API response mapping.");
  }

  // Calculate Extrapolated Global Yield
  let totalNetworkWeight = 0;
  for (const t of tierStructure) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }
  
  const usdPerWeightUnit = totalSampleUsd / SAMPLE_WEIGHT;
  const global7DayUsd = usdPerWeightUnit * totalNetworkWeight;
  
  return global7DayUsd;
}
