(function(){
var PAID = [{"tool":"descargarInforme","network":"base","chainId":8453,"amount":0.05,"amountUnits":"50000","currency":"USDC","payTo":"0x1111111111111111111111111111111111111111","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","protocol":"x402","decimals":6}];
var LIMITS = {};
var spent = 0;
function provider(){ return window.ethereum || (window.WalletConnectProvider && window.WalletConnectProvider.default ? new window.WalletConnectProvider.default({}) : null); }
async function connect(){
  var p = provider(); if (!p) throw new Error('No hay billetera EIP-1193 (instala MetaMask o carga WalletConnect)');
  var accounts = await p.request({ method: 'eth_requestAccounts' });
  var chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
  window.__WEBMCP_WALLET__.account = accounts[0]; window.__WEBMCP_WALLET__.chainId = chainId;
  return { account: accounts[0], chainId: chainId };
}
function canSpend(amount, to){
  var reasons = [];
  if (LIMITS.perTx !== undefined && amount > LIMITS.perTx) reasons.push('supera el limite por operacion');
  if (LIMITS.perSession !== undefined && spent + amount > LIMITS.perSession) reasons.push('supera el limite de sesion');
  if (LIMITS.allowedRecipients && LIMITS.allowedRecipients.length && LIMITS.allowedRecipients.map(function(a){return a.toLowerCase();}).indexOf(to.toLowerCase()) < 0) reasons.push('receptor no permitido');
  return { allowed: reasons.length === 0, reasons: reasons };
}
async function switchChain(chainId){
  var p = provider();
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + chainId.toString(16) }] }); } catch (e) { throw new Error('Cambia la red de la billetera a chainId ' + chainId); }
}
async function signAuthorization(req){
  var p = provider(); var from = window.__WEBMCP_WALLET__.account || (await connect()).account;
  if (window.__WEBMCP_WALLET__.chainId !== req.chainId) await switchChain(req.chainId);
  var now = Math.floor(Date.now() / 1000);
  var nonceBytes = new Uint8Array(32); crypto.getRandomValues(nonceBytes);
  var nonce = '0x' + Array.from(nonceBytes).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  var message = { from: from, to: req.payTo, value: req.amountUnits, validAfter: String(now - 60), validBefore: String(now + 300), nonce: nonce };
  var typed = { types: { EIP712Domain: [{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}], TransferWithAuthorization: [{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"},{"name":"validAfter","type":"uint256"},{"name":"validBefore","type":"uint256"},{"name":"nonce","type":"bytes32"}] }, primaryType: 'TransferWithAuthorization', domain: { name: 'USD Coin', version: '2', chainId: req.chainId, verifyingContract: req.asset }, message: message };
  var signature = await p.request({ method: 'eth_signTypedData_v4', params: [from, JSON.stringify(typed)] });
  return { x402Version: 1, scheme: 'exact', network: req.network, payload: { signature: signature, authorization: message } };
}
async function payTool(name){
  var req = PAID.filter(function(r){ return r.tool === name; })[0];
  if (!req) return { paid: false, reason: 'la tool no requiere pago' };
  var check = canSpend(req.amount, req.payTo);
  if (!check.allowed) return { paid: false, reason: check.reasons.join('; ') };
  if (req.protocol === 'x402') {
    var payload = await signAuthorization(req);
    spent += req.amount;
    return { paid: true, header: btoa(JSON.stringify(payload)), payload: payload };
  }
  var p = provider(); var from = window.__WEBMCP_WALLET__.account || (await connect()).account;
  if (window.__WEBMCP_WALLET__.chainId !== req.chainId) await switchChain(req.chainId);
  var value = '0x' + BigInt(req.amountUnits).toString(16);
  var tx = await p.request({ method: 'eth_sendTransaction', params: [{ from: from, to: req.payTo, value: value }] });
  spent += req.amount;
  return { paid: true, txHash: tx };
}
window.__WEBMCP_WALLET__ = { version: '1.0.1', paidTools: PAID, limits: LIMITS, account: null, chainId: null, connect: connect, payTool: payTool, signAuthorization: signAuthorization, canSpend: canSpend, get spent(){ return spent; } };
})();