async function getGlobalYield(sevenDaysAgo, activationStats) {
  console.log("Fetching Yield via Dual-Capture T4 Oracle (Wallet Sampling)...");
  
  // The Baseline Wallet used to measure total yield per weight unit
  // Using your T4 Partner (Weight: 333) as the 7-Day Ground Truth
  const SAMPLE_WALLET = "0xe7207caa913b54aa4411e847a3a49eee0568cccf".toLowerCase();
  const SAMPLE_WEIGHT = 333; 

  let sampleEthInflow = 0;
  let sampleErc20Usd = 0;

  console.log("1. Tracking Native ETH deposited to Oracle Wallet...");
  let pageEth = 1;
  while(true) {
      // Query internal txs directly TO the sample wallet
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
        
        const fromAddr = (tx.from || "").toLowerCase();
        // Capture ETH from protocol contracts TO the user wallet
        if (PROTOCOL_CONTRACTS.includes(fromAddr) && (tx.to || "").toLowerCase() === SAMPLE_WALLET) {
          const eth = Number(tx.value || 0) / 1e18;
          if (eth > 0) sampleEthInflow += eth;
        }
      }
      
      if(reachedOlder || txs.length < 1000) break;
      pageEth++;
      await sleep(300);
  }

  console.log("2. Tracking Tracked ERC-20 Tokens deposited to Oracle Wallet...");
  for (const tokenAddr of Object.keys(TOKEN_TICKERS)) {
    const price = prices[tokenAddr] || 0;
    if (price <= 0) continue; // Skip unpriced tokens to prevent fake volume
    
    let pageTok = 1;
    while(true) {
        // Query token txs directly TO the sample wallet
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
          
          const fromAddr = (tx.from || "").toLowerCase();
          // Capture Valid Tokens from protocol contracts TO the user wallet
          if (PROTOCOL_CONTRACTS.includes(fromAddr) && (tx.to || "").toLowerCase() === SAMPLE_WALLET) {
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

  // Calculate the Total 7-Day USD Value received by the T4 Oracle Wallet
  const sampleEthUsd = sampleEthInflow * market.ethPriceUsd;
  const totalSampleUsd = sampleEthUsd + sampleErc20Usd;
  
  console.log(`  -> Oracle 7D ETH Yield: $${sampleEthUsd.toFixed(2)} (${sampleEthInflow.toFixed(4)} ETH)`);
  console.log(`  -> Oracle 7D ERC-20 Yield: $${sampleErc20Usd.toFixed(2)}`);
  console.log(`  -> Total Oracle 7D USD Received: $${totalSampleUsd.toFixed(2)}`);

  // Extrapolate the Global 7-Day USD pool across the network
  let totalNetworkWeight = 0;
  for (const t of tierStructure) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }
  
  // (Total T4 USD / T4 Weight) * Total Network Weight = True Global Yield
  const usdPerWeightUnit = totalSampleUsd / SAMPLE_WEIGHT;
  const global7DayUsd = usdPerWeightUnit * totalNetworkWeight;

  console.log(`  Extrapolated Global 7D Yield: $${global7DayUsd.toFixed(2)}`);
  
  return global7DayUsd;
}
