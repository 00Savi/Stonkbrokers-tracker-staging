async function getGlobalYield(sevenDaysAgo) {
  console.log("Fetching Top-Line Gross ETH Inflow across protocol contracts...");
  let totalEthInflow = 0;

  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    // Track Native ETH entering the protocol via normal transactions
    let pageEth = 1;
    while(true) {
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
          
          // If the destination address is the protocol contract, it is Top-Line Revenue
          if ((tx.to || "").toLowerCase() === pL) {
            const eth = Number(tx.value || 0) / 1e18;
            if (eth > 0) totalEthInflow += eth;
          }
        }
        
        if(reachedOlder || txs.length < 10000) break;
        pageEth++;
        await sleep(300);
    }
  }
  
  // Convert Total Gross ETH directly to USD
  const totalUsd = totalEthInflow * market.ethPriceUsd;
  return totalUsd;
}
