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
      
      if(txs.length === 0) {
         console.log(`  -> API returned 0 internal txs on page ${pageEth}.`);
         break;
      }

      // DEBUG: Print the exact structure of the first transaction so we can see the keys
      if (pageEth === 1 && txs.length > 0) {
         console.log("  -> DEBUG FIRST TX JSON STRUCTURE:", JSON.stringify(txs[0]));
      }
      
      let reachedOlder = false;
      for (const tx of txs) {
        // Aggressive timestamp checking
        const rawTs = tx.timeStamp || tx.timestamp || tx.UnixTimestamp || tx.unixtimestamp || 0;
        const ts = parseInt(rawTs, 10);
        
        if (ts === 0) {
            console.log("  -> WARNING: Could not find timestamp on tx!");
            continue;
        }

        if (ts < sevenDaysAgo) {
          reachedOlder = true;
          continue;
        }
        
        // Some APIs use 1 for error, some use "1", some omit it entirely if success
        if (tx.isError === "1" || tx.isError === 1 || (tx.errCode && tx.errCode !== "")) continue;
        
        // Aggressive address mapping
        const fromAddr = (tx.from || tx.fromAddress || tx.contractAddress || "").toLowerCase();
        const toAddr = (tx.to || tx.toAddress || "").toLowerCase();
        
        if (PROTOCOL_CONTRACTS.includes(fromAddr) && toAddr === SAMPLE_WALLET) {
          const rawValue = tx.value || tx.Value || 0;
          const eth = Number(rawValue) / 1e18;
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
          const rawTs = tx.timeStamp || tx.timestamp || tx.UnixTimestamp || tx.unixtimestamp || 0;
          const ts = parseInt(rawTs, 10);
          
          if (ts < sevenDaysAgo) {
            reachedOlder = true;
            continue;
          }
          
          if (tx.isError === "1" || tx.isError === 1) continue;
          
          const fromAddr = (tx.from || tx.fromAddress || "").toLowerCase();
          const toAddr = (tx.to || tx.toAddress || "").toLowerCase();
          
          if (PROTOCOL_CONTRACTS.includes(fromAddr) && toAddr === SAMPLE_WALLET) {
            const decRaw = tx.tokenDecimal || tx.decimals || 18;
            const decimals = parseInt(decRaw, 10);
            const rawValue = tx.value || tx.Value || 0;
            const amount = Number(rawValue) / Math.pow(10, decimals);
            
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
