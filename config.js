/**
 * Configuração opcional do LinkView.
 *
 * O padrão usa o serviço público de sinalização do PeerJS. Para produção,
 * aponte `peerOptions` para uma instância própria do PeerServer e acrescente
 * as origens HTTPS/WSS desse host ao `connect-src` em index.html.
 */
window.LINKVIEW_CONFIG = {
  // 0 = sem limite artificial de espectadores conectados. Use um número
  // positivo para impor um limite. A capacidade real depende do upload e CPU.
  maxViewers: 0,
  // Proteção contra muitas tentativas simultâneas ainda não autenticadas.
  // Isto não limita o total de pessoas que já estão assistindo.
  maxPendingViewers: 16,
  peerOptions: {
    debug: 1,
  },
};
