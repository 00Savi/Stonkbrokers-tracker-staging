async function getGlobalYield(sevenDaysAgo, activationStats) {
  console.log("Fetching Global Yield...");
  let totalErc20Usd = 0;
  let sampleWalletEthInflow = 0;

  // The Baseline Wallets used to measure ETH per weight unit
  // Currently using a T4 Partner (Weight: 333)
  const SAMPLE_WALLET = "0xe7207caa913b54aa4411e847a3a49eee0568cccf".toLowerCase();
  const SAMPLE_WEIGHT = 333; 

  console.log("1. Tracking Native ETH Payouts via Representative Wallet Trace...");
  let pageEth = 1;
  while(true) {
      // Query internal txs directly TO the sample wallet (Blockscout indexes wallet internals cleanly)
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
        
        // Sum all Native ETH deposited into the sample wallet from the distribution contracts
        const fromAddr = (tx.from || "").toLowerCase();
        if (PROTOCOL_CONTRACTS.includes(fromAddr)) {
          const eth = Number(tx.value || 0) / 1e18;
          if (eth > 0) sampleWalletEthInflow += eth;
        }
      }
      
      if(reachedOlder || txs.length < 1000) break;
      pageEth++;
      await sleep(300);
  }

  // Calculate exact ETH paid per weight unit, then extrapolate across the total network
  let totalNetworkWeight = 0;
  for (const t of tierStructure) {
    const activeInTier = activationStats.breakdown[t.id] || 0;
    totalNetworkWeight += (activeInTier * t.weight);
  }
  
  const ethPerWeightUnit = sampleWalletEthInflow / SAMPLE_WEIGHT;
  const globalEthYield = ethPerWeightUnit * totalNetworkWeight;
  const globalEthUsd = globalEthYield * market.ethPriceUsd;

  console.log(`  Sample 7D ETH: ${sampleWalletEthInflow.toFixed(4)} ETH (Extrapolated Global: $${globalEthUsd.toFixed(2)})`);

  console.log("2. Tracking Global ERC-20 Outflows from Protocol Contracts...");
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
            const ts = parseInt(tx.timeStamp || 0, 10);
            if (ts < sevenDaysAgo) {
              reachedOlder = true;
              continue;
            }
            if (tx.isError === "1") continue;

            // Capture valid token transfers leaving the protocol
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
