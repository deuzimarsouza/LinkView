# LinkView

LinkView é um projeto estático em HTML, CSS e JavaScript para compartilhar a tela com áudio por um link. A mídia usa WebRTC e segue diretamente do navegador do transmissor para o navegador de quem assiste.

## O que já está incluído

- captura de tela, janela ou aba;
- áudio da tela quando o navegador oferece essa opção;
- perfis de 1080p, 720p e 480p;
- escolha entre 60 FPS e 30 FPS;
- link de convite protegido por um segredo aleatório;
- um espectador por transmissão, com vídeo, áudio e tela cheia;
- ajuste de qualidade sem trocar o link;
- tratamento de permissão negada, link inválido, transmissor offline, autoplay bloqueado e ausência de áudio;
- layout responsivo e navegação por teclado;
- pronto para uma hospedagem estática como o GitHub Pages.

## Como testar localmente

Como a captura de tela exige um contexto seguro, use `localhost` em vez de abrir o `index.html` diretamente:

```bash
python -m http.server 4173
```

Depois, abra `http://localhost:4173`.

1. Em um computador, escolha a resolução e a taxa de quadros.
2. Clique em **Compartilhar minha tela**.
3. Se quiser transmitir áudio, marque **Compartilhar áudio** no seletor do navegador.
4. Copie o link exibido.
5. Abra o link em outro navegador ou aparelho e clique em **Assistir agora**.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie o conteúdo desta pasta para a raiz do repositório.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Selecione a branch `main`, a pasta `/ (root)` e salve.
5. Quando o endereço for publicado, ative **Enforce HTTPS** se a opção estiver disponível.

O convite usa o fragmento `#watch=...`, então não precisa de rotas no servidor e funciona normalmente no GitHub Pages.

O cartão social está em `assets/og.png`. Se a plataforma em que o link será compartilhado exigir uma URL absoluta, troque `assets/og.png` nas metatags Open Graph e X/Twitter de `index.html` pela URL completa publicada no GitHub Pages.

## Compatibilidade de áudio

Para transmitir, prefira Chrome ou Edge em um computador.

| Navegador do transmissor | Tela | Áudio esperado |
| --- | --- | --- |
| Chrome/Edge no Windows ou ChromeOS | Sim | Aba e, em alguns modos, áudio do sistema |
| Chrome/Edge no macOS ou Linux | Sim | Principalmente áudio de aba |
| Firefox e Safari no desktop | Sim | A captura normalmente chega sem áudio |
| Navegadores móveis | Limitado | Use o aparelho para assistir |

O navegador pode entregar uma resolução ou taxa de quadros menor do que a solicitada, dependendo da tela, CPU, codificador e rede. O LinkView exibe a configuração efetivamente capturada sempre que o navegador a informa.

## Como funciona

O GitHub Pages hospeda somente os arquivos do aplicativo. Para os navegadores se encontrarem, o projeto usa o PeerJS 1.5.5 e, por padrão, o PeerServer Cloud público como sinalização.

1. O transmissor captura a tela com `getDisplayMedia()`.
2. O PeerJS gera um identificador temporário.
3. O LinkView cria um segredo aleatório de 128 bits e coloca ID + segredo no fragmento do link.
4. Quem assiste abre primeiro um canal WebRTC de dados e apresenta o segredo.
5. Somente após a validação o transmissor inicia a chamada de mídia unidirecional.
6. O vídeo e o áudio usam a criptografia obrigatória do WebRTC e não passam pelo GitHub Pages.

O fragmento do convite não é enviado ao servidor HTTP. Assim que o espectador entra, o LinkView também remove o convite da barra de endereço; ele continua apenas na memória daquela página.

## Limites importantes

- O PeerServer Cloud é gratuito e adequado para demonstrações, mas não oferece garantia de disponibilidade para produção.
- A mídia é P2P. Alguns firewalls empresariais e NATs simétricos exigem um servidor TURN.
- Sem TURN em modo relay, os participantes podem descobrir os endereços IP usados na conexão P2P.
- Credenciais TURN permanentes nunca devem ser colocadas em um repositório público. Em produção, gere credenciais temporárias por um endpoint protegido.
- Cada espectador exige mais upload e processamento do transmissor. Por isso, a configuração padrão aceita uma pessoa. Para audiências maiores, use uma SFU e um backend dedicado.
- Qualquer pessoa com o link completo pode assistir enquanto a sessão estiver ativa. Trate o link como uma credencial.
- O LinkView não grava a tela e não envia o conteúdo a um servidor de armazenamento.

## Usar um PeerServer próprio

Edite `config.js` e informe sua infraestrutura:

```js
window.LINKVIEW_CONFIG = {
  maxViewers: 1,
  peerOptions: {
    host: "peer.exemplo.com",
    port: 443,
    path: "/peerjs",
    secure: true,
    config: {
      iceServers: [
        { urls: "stun:stun.exemplo.com:3478" },
        {
          urls: "turn:turn.exemplo.com:3478",
          username: "CREDENCIAL_TEMPORARIA",
          credential: "SEGREDO_TEMPORARIO",
        },
      ],
    },
  },
};
```

Se você aumentar `maxViewers`, faça testes de upload e CPU no equipamento do transmissor. Para grupos, não trate esse ajuste como substituto de uma SFU.

Ao trocar o domínio de sinalização, inclua também as origens HTTPS e WSS do seu PeerServer na diretiva `connect-src` da política de segurança em `index.html`.

## Estrutura

```text
LinkView/
├── assets/
│   ├── favicon.svg
│   └── og.png
├── app.js
├── config.js
├── index.html
├── styles.css
├── LICENSE
└── README.md
```

## Licença

MIT. Consulte `LICENSE`.

## Referências técnicas

- [Screen Capture API — W3C](https://www.w3.org/TR/screen-capture/)
- [PeerJS — documentação do cliente](https://peerjs.com/docs/)
- [PeerServer Cloud](https://peerjs.com/server/cloud)
- [TURN para WebRTC](https://webrtc.org/getting-started/turn-server)
- [HTTPS no GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
