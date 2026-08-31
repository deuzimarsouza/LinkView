/**
 * Configuração opcional do LinkView.
 *
 * O padrão usa o serviço público de sinalização do PeerJS. Para produção,
 * aponte `peerOptions` para uma instância própria do PeerServer e acrescente
 * as origens HTTPS/WSS desse host ao `connect-src` em index.html.
 */
window.LINKVIEW_CONFIG = {
  // O MVP é pensado para uma transmissão individual. Aumente com cuidado:
  // cada espectador consome uma nova parcela do upload do transmissor.
  maxViewers: 1,
  peerOptions: {
    debug: 1,
  },
};
