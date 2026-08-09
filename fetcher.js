async function getGlobalYield(sevenDaysAgo) {
  console.log("Fetching Global Yield via deep-paginated outbound internal ETH transfers...");
  let totalEthOutflow = 0;

  for (const pAddr of PROTOCOL_CONTRACTS) {
    const pL = pAddr.toLowerCase();
    
    let page = 1;
    while(true) {
        const url = `${PRO_API}?chain_id=${CHAIN_ID}&module=account&action=txlistinternal&address=${pAddr}&page=${page}&offset=1000&sort=desc&apikey=${API_KEY}`;
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
          
          // Capture ETH leaving the protocol contract to brokers
          if ((tx.from || "").toLowerCase() === pL) {
            const eth = Number(tx.value || 0) / 1e18;
            if (eth > 0) {
              totalEthOutflow += eth;
            }
          }
        }
        
        if (reachedOlder || txs.length < 1000) break;
        page++;
        await sleep(300);
    }
  }

  const totalUsd = totalEthOutflow * market.ethPriceUsd;
  return totalUsd;
}
