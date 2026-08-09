async function getGlobalYield(sevenDaysAgo) {
  console.log("Fetching Global Yield via normal transactions (bypassing internal trace bug)...");
  let totalEthInflow = 0;

  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    let page = 1;
    while(true) {
        // Using action=txlist (normal transactions) which Blockscout indexes reliably
        const url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlist&address=${pAddr}&page=${page}&offset=1000&sort=desc&apikey=${API_KEY}`;
        const data = await secureFetch(url);
        const txs = Array.isArray(data.result) ? data.result : [];
        
        console.log(`  Checking page ${page} for contract ${pAddr}: found ${txs.length} transactions.`);
        if (txs.length === 0) break;
        
        let reachedOlder = false;
        for (const tx of txs) {
          const ts = parseInt(tx.timeStamp || 0, 10);
          if (ts < sevenDaysAgo) {
            reachedOlder = true;
            continue;
          }
          if (tx.isError === "1") continue;
          
          // Capture ETH moving into or through the protocol contracts
          if ((tx.to || "").toLowerCase() === pL || (tx.from || "").toLowerCase() === pL) {
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

  console.log(`  Total 7-Day ETH Inflow Captured: ${totalEthInflow} ETH`);
  const totalUsd = totalEthInflow * market.ethPriceUsd;
  return totalUsd;
}
