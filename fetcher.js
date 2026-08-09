async function getGlobalYield(sevenDaysAgo) {
  console.log("Fetching Global Yield logs across all protocol contracts...");
  let totalUsd = 0;

  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    // 1. Native ETH Transfers IN (Bypassing the Blockscout outbound trace bug)
    let pageEth = 1;
    while(true) {
        // Changed to action=txlist to track deposits entering the contract
        const urlEth = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlist&address=${pAddr}&page=${pageEth}&offset=10000&sort=desc&apikey=${API_KEY}`;
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
          
          // Capture ETH coming TO the protocol contract
          if ((tx.to || "").toLowerCase() === pL) {
            const eth = Number(tx.value || 0) / 1e18;
            if (eth > 0) totalUsd += eth * market.ethPriceUsd;
          }
        }
        
        if(reachedOlder || txs.length < 10000) break;
        pageEth++;
        await sleep(300);
    }

    // 2. ERC20 Token Transfers OUT (Tokens are tracking perfectly)
    for (const tokenAddr of Object.keys(TOKEN_TICKERS)) {
      const price = prices[tokenAddr] || 0;
      if (price <= 0) continue;
      
      let pageTok = 1;
      while(true) {
          const urlTok = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=tokentx&address=${pAddr}&contractaddress=${tokenAddr}&page=${pageTok}&offset=10000&sort=desc&apikey=${API_KEY}`;
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
              if (amount > 0) totalUsd += amount * price;
            }
          }
          
          if(reachedOlder || txs.length < 10000) break;
          pageTok++;
          await sleep(300);
      }
    }
  }
  return totalUsd;
}
