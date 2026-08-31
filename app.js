"use strict";

(() => {
  const PROFILES = {
    1080: { width: 1920, height: 1080, label: "1080p" },
    720: { width: 1280, height: 720, label: "720p" },
    480: { width: 854, height: 480, label: "480p" },
  };

  const BANDWIDTH_COPY = {
    "1080-60": "Mais nitidez e fluidez. Recomendamos 8–12 Mbps de upload por espectador.",
    "1080-30": "Imagem Full HD. Recomendamos 4–7 Mbps de upload por espectador.",
    "720-60": "Movimento fluido em HD. Recomendamos 4–7 Mbps de upload por espectador.",
    "720-30": "Ideal para a maioria das conexões. Uso estimado: 2–4 Mbps por espectador.",
    "480-60": "Movimento fluido com economia. Uso estimado: 2–3 Mbps por espectador.",
    "480-30": "A opção mais leve. Uso estimado: 1–2 Mbps por espectador.",
  };

  const DEFAULT_CONFIG = {
    // 0 desativa o limite artificial de espectadores conectados.
    maxViewers: 0,
    // Limita somente conexões simultâneas que ainda não provaram possuir o convite.
    maxPendingViewers: 16,
    peerOptions: { debug: 1 },
  };

  const suppliedConfig = window.LINKVIEW_CONFIG || {};
  const requestedViewerLimit = Number(suppliedConfig.maxViewers ?? DEFAULT_CONFIG.maxViewers);
  const requestedPendingLimit = Number(suppliedConfig.maxPendingViewers ?? DEFAULT_CONFIG.maxPendingViewers);
  const config = {
    ...DEFAULT_CONFIG,
    ...suppliedConfig,
    maxViewers: Number.isFinite(requestedViewerLimit) && requestedViewerLimit > 0
      ? Math.max(1, Math.floor(requestedViewerLimit))
      : 0,
    maxPendingViewers: Number.isFinite(requestedPendingLimit) && requestedPendingLimit > 0
      ? Math.max(4, Math.min(64, Math.floor(requestedPendingLimit)))
      : DEFAULT_CONFIG.maxPendingViewers,
    peerOptions: {
      ...DEFAULT_CONFIG.peerOptions,
      ...(suppliedConfig.peerOptions || {}),
    },
  };

  const state = {
    role: "idle",
    peer: null,
    localStream: null,
    remoteStream: null,
    roomToken: "",
    hostId: "",
    shareUrl: "",
    profile: { quality: "720", fps: 30 },
    viewers: new Map(),
    pendingViewers: new Set(),
    hostGeneration: 0,
    viewerConnection: null,
    mediaCall: null,
    viewerGeneration: 0,
    pendingInvite: null,
    viewerTimeout: null,
    statsTimer: null,
    toastTimer: null,
    lastRetryAction: null,
    ending: false,
    hasRenderedOnce: false,
    settingsReturnFocusToMenu: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    setupView: $("#setup-view"),
    hostView: $("#host-view"),
    viewerView: $("#viewer-view"),
    errorView: $("#error-view"),
    broadcastTab: $("#broadcast-tab"),
    watchTab: $("#watch-tab"),
    broadcastPanel: $("#broadcast-panel"),
    watchPanel: $("#watch-panel"),
    startBroadcast: $("#start-broadcast"),
    bandwidthCopy: $("#bandwidth-copy"),
    watchLink: $("#watch-link"),
    watchLinkError: $("#watch-link-error"),
    openBroadcast: $("#open-broadcast"),
    localVideo: $("#local-video"),
    hostVideoMeta: $("#host-video-meta"),
    hostEmpty: $("#host-empty"),
    sessionMenuButton: $("#session-menu-button"),
    sessionMenu: $("#session-menu"),
    sessionMenuClose: $("#session-menu-close"),
    hostConnectionBadge: $("#host-connection-badge"),
    viewerCount: $("#viewer-count"),
    viewerLabel: $("#viewer-label"),
    audioIndicator: $("#audio-indicator"),
    audioStatusCopy: $("#audio-status-copy"),
    shareLink: $("#share-link"),
    copyLink: $("#copy-link"),
    nativeShare: $("#native-share"),
    liveQuality: $("#live-quality"),
    liveFps: $("#live-fps"),
    changeSettings: $("#change-settings"),
    stopBroadcast: $("#stop-broadcast"),
    remoteVideo: $("#remote-video"),
    viewerOverlay: $("#viewer-overlay"),
    viewerOverlayTitle: $("#viewer-overlay-title"),
    viewerOverlayCopy: $("#viewer-overlay-copy"),
    joinBroadcast: $("#join-broadcast"),
    viewerHome: $("#viewer-home"),
    resumePlayback: $("#resume-playback"),
    viewerVideoMeta: $("#viewer-video-meta"),
    viewerLiveBadge: $("#viewer-live-badge"),
    viewerBadgeCopy: $("#viewer-badge-copy"),
    viewerConnectionDot: $("#viewer-connection-dot"),
    viewerStatusTitle: $("#viewer-status-title"),
    viewerStatusCopy: $("#viewer-status-copy"),
    viewerFullscreen: $("#viewer-fullscreen"),
    errorTitle: $("#error-title"),
    errorCopy: $("#error-copy"),
    retryAction: $("#retry-action"),
    errorHome: $("#error-home"),
    settingsDialog: $("#settings-dialog"),
    dialogQuality: $("#dialog-quality"),
    dialogFps: $("#dialog-fps"),
    applySettings: $("#apply-settings"),
    privacyInfo: $("#privacy-info"),
    privacyDialog: $("#privacy-dialog"),
    toast: $("#toast"),
    srStatus: $("#sr-status"),
  };

  function init() {
    bindInterface();
    updateProfileFromControls();

    if (!("share" in navigator)) {
      elements.nativeShare.hidden = true;
    }

    const invite = parseInviteHash(window.location.hash);
    if (invite) {
      showViewerInvite(invite);
    } else {
      showSetup();
    }
  }

  function bindInterface() {
    elements.broadcastTab.addEventListener("click", () => activateTab("broadcast"));
    elements.watchTab.addEventListener("click", () => activateTab("watch"));

    [elements.broadcastTab, elements.watchTab].forEach((tab) => {
      tab.addEventListener("keydown", handleTabKeydown);
    });

    $$("input[name='quality'], input[name='fps']").forEach((input) => {
      input.addEventListener("change", updateProfileFromControls);
    });

    elements.startBroadcast.addEventListener("click", startBroadcast);
    elements.openBroadcast.addEventListener("click", openPastedInvite);
    elements.watchLink.addEventListener("input", () => {
      elements.watchLinkError.hidden = true;
      elements.watchLink.setAttribute("aria-invalid", "false");
    });
    elements.watchLink.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openPastedInvite();
    });

    elements.sessionMenuButton.addEventListener("click", () => {
      setSessionMenu(elements.sessionMenu.hidden);
    });
    elements.sessionMenuClose.addEventListener("click", () => setSessionMenu(false, true));
    elements.copyLink.addEventListener("click", copyShareLink);
    elements.nativeShare.addEventListener("click", shareInvite);
    elements.stopBroadcast.addEventListener("click", () => {
      setSessionMenu(false);
      endBroadcast("user");
    });
    elements.changeSettings.addEventListener("click", () => {
      state.settingsReturnFocusToMenu = true;
      setSessionMenu(false);
      openSettingsDialog();
    });
    elements.applySettings.addEventListener("click", applyLiveSettings);
    elements.settingsDialog.addEventListener("close", () => {
      if (!state.settingsReturnFocusToMenu) return;
      state.settingsReturnFocusToMenu = false;
      if (elements.sessionMenuButton.hidden || elements.sessionMenuButton.disabled) return;
      window.requestAnimationFrame(() => elements.sessionMenuButton.focus({ preventScroll: true }));
    });

    elements.joinBroadcast.addEventListener("click", () => {
      if (elements.joinBroadcast.dataset.action === "home") {
        leaveViewer();
      } else {
        joinBroadcast();
      }
    });
    elements.viewerHome.addEventListener("click", leaveViewer);
    elements.resumePlayback.addEventListener("click", resumeRemotePlayback);
    elements.viewerFullscreen.addEventListener("click", openFullscreen);

    elements.errorHome.addEventListener("click", resetToHome);
    elements.retryAction.addEventListener("click", () => {
      if (typeof state.lastRetryAction === "function") state.lastRetryAction();
    });

    elements.privacyInfo.addEventListener("click", () => elements.privacyDialog.showModal());

    document.addEventListener("pointerdown", (event) => {
      if (elements.sessionMenu.hidden) return;
      if (elements.sessionMenu.contains(event.target) || elements.sessionMenuButton.contains(event.target)) return;
      setSessionMenu(false);
    });
    document.addEventListener("focusin", (event) => {
      if (elements.sessionMenu.hidden) return;
      if (elements.sessionMenu.contains(event.target) || elements.sessionMenuButton.contains(event.target)) return;
      setSessionMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || elements.sessionMenu.hidden) return;
      event.preventDefault();
      setSessionMenu(false, true);
    });

    window.addEventListener("pagehide", cleanupAll);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) resetToHome();
    });
    window.addEventListener("hashchange", () => {
      if (state.role !== "idle") return;
      const invite = parseInviteHash(window.location.hash);
      if (invite) showViewerInvite(invite);
    });
  }

  function setSessionMenu(open, restoreFocus = false) {
    const shouldOpen = Boolean(
      open &&
      state.role === "host" &&
      !state.ending &&
      !elements.sessionMenuButton.hidden
    );

    elements.sessionMenu.hidden = !shouldOpen;
    elements.sessionMenuButton.classList.toggle("is-open", shouldOpen);
    elements.sessionMenuButton.setAttribute("aria-expanded", String(shouldOpen));
    elements.sessionMenuButton.setAttribute(
      "aria-label",
      shouldOpen ? "Fechar controles da transmissão" : "Abrir controles da transmissão",
    );

    if (shouldOpen) {
      window.requestAnimationFrame(() => {
        if (!elements.sessionMenu.hidden) elements.sessionMenu.focus({ preventScroll: true });
      });
    } else if (restoreFocus && !elements.sessionMenuButton.hidden && !elements.sessionMenuButton.disabled) {
      window.requestAnimationFrame(() => elements.sessionMenuButton.focus({ preventScroll: true }));
    }
  }

  function activateTab(mode) {
    const broadcastActive = mode === "broadcast";
    elements.broadcastTab.classList.toggle("is-active", broadcastActive);
    elements.broadcastTab.setAttribute("aria-selected", String(broadcastActive));
    elements.broadcastTab.tabIndex = broadcastActive ? 0 : -1;
    elements.watchTab.classList.toggle("is-active", !broadcastActive);
    elements.watchTab.setAttribute("aria-selected", String(!broadcastActive));
    elements.watchTab.tabIndex = broadcastActive ? -1 : 0;
    elements.broadcastPanel.hidden = !broadcastActive;
    elements.watchPanel.hidden = broadcastActive;
  }

  function handleTabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.currentTarget === elements.broadcastTab ? "watch" : "broadcast";
    activateTab(nextMode);
    (nextMode === "broadcast" ? elements.broadcastTab : elements.watchTab).focus();
  }

  function updateProfileFromControls() {
    const quality = $("input[name='quality']:checked")?.value || "720";
    const fps = Number($("input[name='fps']:checked")?.value || 30);
    state.profile = { quality, fps };
    elements.bandwidthCopy.textContent = BANDWIDTH_COPY[`${quality}-${fps}`];
  }

  function getCaptureConstraints(profile) {
    const selected = PROFILES[profile.quality];
    return {
      video: {
        width: { ideal: selected.width, max: selected.width },
        height: { ideal: selected.height, max: selected.height },
        frameRate: { ideal: profile.fps, max: profile.fps },
      },
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    };
  }

  async function startBroadcast() {
    if (state.role !== "idle") return;
    updateProfileFromControls();

    if (!window.isSecureContext) {
      showFatalError(
        "O LinkView precisa de uma conexão segura",
        "Abra o projeto por HTTPS. O GitHub Pages já oferece essa proteção quando o HTTPS está ativado.",
        startBroadcast,
      );
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      showFatalError(
        "Este navegador não transmite a tela",
        "Use Chrome ou Edge em um computador para transmitir. Este aparelho ainda pode assistir a um convite.",
        resetToHome,
      );
      return;
    }

    if (!window.Peer) {
      showFatalError(
        "A conexão não foi carregada",
        "Verifique sua internet e tente novamente. O LinkView precisa alcançar o serviço de sinalização para criar o convite.",
        startBroadcast,
      );
      return;
    }

    setButtonLoading(elements.startBroadcast, true, "Aguardando sua escolha…");
    const hostGeneration = ++state.hostGeneration;
    let captureStarted = false;
    let capturedVideoTrack = null;
    state.role = "host-requesting";

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(getCaptureConstraints(state.profile));
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("missing-video-track");
      captureStarted = true;
      capturedVideoTrack = videoTrack;

      state.role = "host-starting";
      state.localStream = stream;
      videoTrack.contentHint = state.profile.fps === 60 ? "motion" : "detail";
      videoTrack.addEventListener("ended", () => {
        if (hostGeneration === state.hostGeneration && !state.ending) endBroadcast("browser");
      });
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (hostGeneration === state.hostGeneration && state.role === "host") updateAudioStatus();
      });

      announce("Tela selecionada. Criando o link da transmissão.");
      const peer = await createPeer("host", hostGeneration);
      if (
        hostGeneration !== state.hostGeneration ||
        state.ending ||
        videoTrack.readyState === "ended" ||
        !stream.active
      ) {
        peer.destroy();
        if (hostGeneration === state.hostGeneration && !state.ending) {
          cleanupBroadcastResources();
          state.role = "idle";
          showSetup();
          showToast("O compartilhamento foi encerrado antes de o convite ficar pronto.", true);
        }
        return;
      }
      state.peer = peer;
      state.hostId = peer.id;
      state.roomToken = createSecret();
      state.shareUrl = buildShareUrl(state.hostId, state.roomToken);
      state.role = "host";

      peer.on("connection", (connection) => handleViewerConnection(connection, hostGeneration, peer));
      peer.on("disconnected", () => handleHostSignalingDisconnected(hostGeneration, peer));
      peer.on("open", () => {
        if (isCurrentHostSession(hostGeneration, peer) && !state.ending) updateViewerCount();
      });
      peer.on("close", () => {
        if (isCurrentHostSession(hostGeneration, peer) && !state.ending) {
          showToast("A conexão de sinalização foi encerrada.", true);
        }
      });

      elements.localVideo.srcObject = stream;
      await elements.localVideo.play().catch(() => undefined);
      if (!isCurrentHostSession(hostGeneration, peer)) return;
      elements.shareLink.value = state.shareUrl;
      elements.liveQuality.textContent = PROFILES[state.profile.quality].label;
      elements.liveFps.textContent = `${state.profile.fps} FPS`;
      updateAudioStatus();
      updateHostTrackMeta();
      updateViewerCount();
      showView("host");
      startHostMetrics();
      announce("Transmissão iniciada. O link está pronto para ser compartilhado.");
      showToast("Link criado. Compartilhe com quem vai assistir.");
    } catch (error) {
      if (hostGeneration !== state.hostGeneration) return;
      const cancelled = captureStarted && (
        state.ending ||
        state.role !== "host-starting" ||
        capturedVideoTrack?.readyState === "ended"
      );
      if (cancelled) {
        if (!state.ending) {
          cleanupBroadcastResources();
          state.role = "idle";
          showSetup();
        }
        return;
      }
      cleanupBroadcastResources();
      state.role = "idle";
      handleCaptureError(error);
    } finally {
      if (hostGeneration === state.hostGeneration) {
        setButtonLoading(elements.startBroadcast, false);
      }
    }
  }

  function handleCaptureError(error) {
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") {
      showSetup();
      showToast("O compartilhamento não foi iniciado. Você pode tentar novamente.", true);
      return;
    }

    if (error?.name === "NotReadableError") {
      showFatalError(
        "A tela está ocupada por outro aplicativo",
        "Feche outra captura de tela que esteja ativa e tente novamente.",
        startBroadcast,
      );
      return;
    }

    showFatalError(
      "Não foi possível iniciar a transmissão",
      "Confira sua conexão, permita o compartilhamento de tela e tente de novo.",
      startBroadcast,
    );
  }

  function createPeer(role, generation = 0) {
    return new Promise((resolve, reject) => {
      let opened = false;
      let peer;

      try {
        peer = new window.Peer(config.peerOptions);
      } catch (error) {
        reject(error);
        return;
      }

      const timer = window.setTimeout(() => {
        if (opened) return;
        peer.destroy();
        reject(new Error("peer-open-timeout"));
      }, 12000);

      peer.on("open", () => {
        opened = true;
        window.clearTimeout(timer);
        resolve(peer);
      });

      peer.on("error", (error) => {
        if (!opened) {
          window.clearTimeout(timer);
          try { peer.destroy(); } catch { /* já encerrado */ }
          reject(error);
          return;
        }
        handlePeerError(role, error, generation, peer);
      });
    });
  }

  function handlePeerError(role, error, generation, peer) {
    const type = error?.type || "unknown";

    if (role === "viewer") {
      if (generation !== state.viewerGeneration) return;
      if (["peer-unavailable", "network", "server-error", "socket-error"].includes(type)) {
        showViewerUnavailable(
          type === "peer-unavailable"
            ? "O transmissor não está mais disponível neste link."
            : "A conexão foi interrompida. Confira sua internet e tente novamente.",
          generation,
        );
      }
      return;
    }

    if (isCurrentHostSession(generation, peer) && !state.ending) {
      showToast("Houve uma instabilidade na conexão. A transmissão da tela continua aberta.", true);
      elements.hostConnectionBadge.textContent = "Instável";
      elements.hostConnectionBadge.classList.add("waiting");
    }
  }

  function isCurrentHostSession(generation, peer) {
    return generation === state.hostGeneration && state.peer === peer && state.role === "host";
  }

  function handleHostSignalingDisconnected(generation, peer) {
    if (!isCurrentHostSession(generation, peer) || state.ending || peer.destroyed) return;
    elements.hostConnectionBadge.textContent = "Reconectando";
    elements.hostConnectionBadge.classList.add("waiting");

    try {
      peer.reconnect();
    } catch {
      showToast("Não foi possível restabelecer o convite automaticamente.", true);
    }
  }

  function handleViewerConnection(connection, generation, peer) {
    if (
      !isCurrentHostSession(generation, peer) ||
      !state.localStream?.active ||
      connection.metadata?.app !== "LinkView" ||
      connection.metadata?.role !== "viewer" ||
      state.pendingViewers.size >= config.maxPendingViewers
    ) {
      try { connection.close(); } catch { /* conexão ainda não utilizável */ }
      return;
    }

    let authenticated = false;
    let terminal = false;
    let viewerRef = null;
    state.pendingViewers.add(connection);

    const rejectTerminal = (reason) => {
      if (terminal || authenticated) return;
      terminal = true;
      window.clearTimeout(authTimer);
      state.pendingViewers.delete(connection);
      rejectViewer(connection, reason);
    };

    const authTimer = window.setTimeout(() => rejectTerminal("timeout"), 8000);

    connection.on("data", (payload) => {
      if (authenticated || terminal) return;
      if (!isCurrentHostSession(generation, peer) || !state.localStream?.active) {
        rejectTerminal("ended");
        return;
      }
      if (!payload || payload.type !== "watch" || !safeTokenEqual(payload.token, state.roomToken)) {
        rejectTerminal("invalid");
        return;
      }

      if (state.viewers.has(connection.peer)) {
        rejectTerminal("duplicate");
        return;
      }

      if (config.maxViewers > 0 && state.viewers.size >= config.maxViewers) {
        rejectTerminal("full");
        return;
      }

      authenticated = true;
      window.clearTimeout(authTimer);
      state.pendingViewers.delete(connection);
      viewerRef = acceptViewer(connection, generation, peer);
      if (!viewerRef) {
        authenticated = false;
        terminal = true;
      }
    });

    connection.on("close", () => {
      window.clearTimeout(authTimer);
      state.pendingViewers.delete(connection);
      if (authenticated) removeViewer(connection.peer, viewerRef);
    });

    connection.on("error", () => {
      window.clearTimeout(authTimer);
      state.pendingViewers.delete(connection);
      if (authenticated) removeViewer(connection.peer, viewerRef);
    });
  }

  function rejectViewer(connection, reason) {
    try {
      connection.send({ type: "rejected", reason });
    } catch {
      // A conexão pode ter sido fechada antes do aviso.
    }
    window.setTimeout(() => connection.close(), 120);
  }

  function acceptViewer(connection, generation, peer) {
    if (!isCurrentHostSession(generation, peer)) return null;
    const actual = getTrackSnapshot(state.localStream?.getVideoTracks()[0]);
    const viewer = { connection, call: null, removed: false };
    state.viewers.set(connection.peer, viewer);

    connection.send({
      type: "accepted",
      profile: state.profile,
      actual,
      audio: hasLiveAudio(state.localStream),
    });

    let call;
    try {
      call = peer.call(connection.peer, state.localStream, {
        metadata: { app: "LinkView", role: "host", version: 1 },
      });
    } catch {
      rejectViewer(connection, "media-error");
      removeViewer(connection.peer, viewer);
      return null;
    }

    if (!call) {
      rejectViewer(connection, "media-error");
      removeViewer(connection.peer, viewer);
      return null;
    }

    viewer.call = call;
    call.on("close", () => removeViewer(connection.peer, viewer));
    call.on("error", () => removeViewer(connection.peer, viewer));
    updateViewerCount();
    announce(`${state.viewers.size} ${state.viewers.size === 1 ? "espectador conectado" : "espectadores conectados"}.`);
    return viewer;
  }

  function removeViewer(peerId, expectedViewer = null) {
    const viewer = state.viewers.get(peerId);
    if (expectedViewer && viewer !== expectedViewer) return;
    if (!viewer || viewer.removed) return;
    viewer.removed = true;
    state.viewers.delete(peerId);

    try { viewer.call?.close(); } catch { /* já encerrada */ }
    try { viewer.connection?.close(); } catch { /* já encerrada */ }
    updateViewerCount();
  }

  function updateViewerCount() {
    const count = state.viewers.size;
    elements.viewerCount.textContent = String(count);
    elements.viewerLabel.textContent = count === 1 ? "espectador conectado" : "espectadores conectados";
    elements.hostConnectionBadge.classList.toggle("waiting", count === 0);
    elements.hostConnectionBadge.textContent = count === 0 ? "Aguardando" : "Conectado";
  }

  function updateAudioStatus() {
    const audioTrack = state.localStream?.getAudioTracks()[0];
    const hasAudio = audioTrack?.readyState === "live";
    elements.audioIndicator.classList.toggle("is-active", hasAudio);
    elements.audioIndicator.classList.toggle("is-warning", !hasAudio);
    elements.audioStatusCopy.textContent = hasAudio
      ? "Áudio da tela incluído"
      : "Sem áudio — reinicie e marque “Compartilhar áudio”";

    if (!hasAudio) {
      showToast("A tela foi compartilhada sem áudio. Para incluí-lo, reinicie e marque “Compartilhar áudio”.", true);
    }
  }

  function updateHostTrackMeta() {
    const track = state.localStream?.getVideoTracks()[0];
    const settings = getTrackSnapshot(track);
    const dimensions = settings.width && settings.height
      ? `${settings.width} × ${settings.height}`
      : PROFILES[state.profile.quality].label;
    const fps = settings.frameRate ? `${Math.round(settings.frameRate)} FPS` : `${state.profile.fps} FPS solicitados`;
    elements.hostVideoMeta.textContent = `${dimensions} · ${fps}`;
  }

  function startHostMetrics() {
    window.clearInterval(state.statsTimer);
    state.statsTimer = window.setInterval(updateHostTrackMeta, 2000);
  }

  async function copyShareLink() {
    if (!state.shareUrl) return;
    try {
      await navigator.clipboard.writeText(state.shareUrl);
    } catch {
      elements.shareLink.focus();
      elements.shareLink.select();
      document.execCommand("copy");
      elements.shareLink.setSelectionRange(0, 0);
    }
    showToast("Link copiado.");
    announce("Link da transmissão copiado.");
  }

  async function shareInvite() {
    if (!navigator.share || !state.shareUrl) return;
    try {
      await navigator.share({
        title: "Assista à minha tela no LinkView",
        text: "Abra este link para assistir à minha transmissão ao vivo:",
        url: state.shareUrl,
      });
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Não foi possível abrir o menu de compartilhamento.", true);
    }
  }

  function openSettingsDialog() {
    if (elements.applySettings.disabled) setButtonLoading(elements.applySettings, false);
    elements.dialogQuality.value = state.profile.quality;
    elements.dialogFps.value = String(state.profile.fps);
    elements.settingsDialog.showModal();
  }

  async function applyLiveSettings(event) {
    event.preventDefault();
    const track = state.localStream?.getVideoTracks()[0];
    const generation = state.hostGeneration;
    const peer = state.peer;
    if (!track || !isCurrentHostSession(generation, peer)) return;

    const nextProfile = {
      quality: elements.dialogQuality.value,
      fps: Number(elements.dialogFps.value),
    };
    const selected = PROFILES[nextProfile.quality];
    setButtonLoading(elements.applySettings, true, "Aplicando…");

    try {
      await track.applyConstraints({
        width: { ideal: selected.width, max: selected.width },
        height: { ideal: selected.height, max: selected.height },
        frameRate: { ideal: nextProfile.fps, max: nextProfile.fps },
      });
      if (
        !isCurrentHostSession(generation, peer) ||
        state.localStream?.getVideoTracks()[0] !== track
      ) return;
      track.contentHint = nextProfile.fps === 60 ? "motion" : "detail";
      state.profile = nextProfile;
      syncSetupControls();
      elements.liveQuality.textContent = selected.label;
      elements.liveFps.textContent = `${nextProfile.fps} FPS`;
      updateHostTrackMeta();

      const actual = getTrackSnapshot(track);
      state.viewers.forEach(({ connection }) => {
        try { connection.send({ type: "profile", profile: nextProfile, actual }); } catch { /* sem ação */ }
      });

      elements.settingsDialog.close();
      showToast("A qualidade foi ajustada.");
    } catch {
      if (generation === state.hostGeneration) {
        showToast("O navegador não conseguiu aplicar essa combinação. A configuração anterior foi mantida.", true);
      }
    } finally {
      if (generation === state.hostGeneration) setButtonLoading(elements.applySettings, false);
    }
  }

  function syncSetupControls() {
    const qualityInput = $(`input[name='quality'][value='${state.profile.quality}']`);
    const fpsInput = $(`input[name='fps'][value='${state.profile.fps}']`);
    if (qualityInput) qualityInput.checked = true;
    if (fpsInput) fpsInput.checked = true;
    elements.bandwidthCopy.textContent = BANDWIDTH_COPY[`${state.profile.quality}-${state.profile.fps}`];
  }

  function openPastedInvite() {
    const invite = parseInviteInput(elements.watchLink.value);
    if (!invite) {
      elements.watchLinkError.hidden = false;
      elements.watchLink.setAttribute("aria-invalid", "true");
      elements.watchLink.focus();
      return;
    }

    elements.watchLinkError.hidden = true;
    elements.watchLink.setAttribute("aria-invalid", "false");
    const hash = `#watch=${encodeURIComponent(invite.hostId)}.${invite.token}`;
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    showViewerInvite(invite);
  }

  function showViewerInvite(invite) {
    cleanupViewerResources(false);
    state.pendingInvite = invite;
    state.role = "invite";
    elements.viewerOverlay.hidden = false;
    elements.viewerOverlayTitle.textContent = "Pronto para assistir?";
    elements.viewerOverlayCopy.textContent = "Entre na transmissão para receber vídeo e áudio em tempo real.";
    elements.joinBroadcast.dataset.action = "join";
    elements.joinBroadcast.querySelector("span").textContent = "Assistir agora";
    elements.joinBroadcast.disabled = false;
    elements.viewerHome.hidden = false;
    elements.viewerVideoMeta.hidden = true;
    elements.resumePlayback.hidden = true;
    setViewerStatus("Convite reconhecido", "Aguardando você entrar.", "waiting");
    setViewerLiveState(false, "AGUARDANDO");
    showView("viewer");
  }

  async function joinBroadcast() {
    if (!state.pendingInvite || state.role === "viewer-connecting" || state.role === "viewer") return;
    const generation = ++state.viewerGeneration;
    const invite = { ...state.pendingInvite };
    state.role = "viewer-connecting";

    if (!window.isSecureContext || !window.Peer) {
      showViewerUnavailable(
        "O recurso de conexão não foi carregado. Verifique sua internet e tente novamente.",
        generation,
      );
      return;
    }

    stripInviteFromAddressBar();
    setButtonLoading(elements.joinBroadcast, true, "Conectando…");
    elements.viewerOverlayTitle.textContent = "Procurando o transmissor…";
    elements.viewerOverlayCopy.textContent = "Isso costuma levar apenas alguns segundos.";
    setViewerStatus("Conectando", "Localizando a transmissão com segurança.", "waiting");

    try {
      const peer = await createPeer("viewer", generation);
      if (generation !== state.viewerGeneration || state.role !== "viewer-connecting") {
        peer.destroy();
        return;
      }

      state.peer = peer;
      peer.on("call", (call) => handleIncomingMediaCall(call, generation, peer));
      peer.on("disconnected", () => {
        if (generation !== state.viewerGeneration || state.peer !== peer) return;
        setViewerStatus("Reconectando", "A conexão de sinalização ficou instável.", "waiting");
        try { peer.reconnect(); } catch { /* a mídia existente pode continuar */ }
      });
      peer.on("open", () => {
        if (generation !== state.viewerGeneration || state.peer !== peer) return;
        if (state.role === "viewer") {
          setViewerStatus(
            "Conectado ao vivo",
            hasLiveAudio(state.remoteStream) ? "Vídeo e áudio recebidos." : "Vídeo recebido sem faixa de áudio.",
            "live",
          );
        } else if (state.role === "viewer-connecting") {
          setViewerStatus("Conectando", "Sinalização restabelecida. Aguardando o vídeo.", "waiting");
        }
      });

      const connection = peer.connect(invite.hostId, {
        reliable: true,
        metadata: { app: "LinkView", role: "viewer", version: 1 },
      });
      state.viewerConnection = connection;

      connection.on("open", () => {
        if (!isCurrentViewerSession(generation, peer, connection)) {
          connection.close();
          return;
        }
        connection.send({ type: "watch", token: invite.token });
        setViewerStatus("Convite enviado", "Aguardando o vídeo do transmissor.", "waiting");
      });

      connection.on("data", (payload) => handleHostMessage(payload, generation, peer, connection));
      connection.on("close", () => {
        if (isCurrentViewerSession(generation, peer, connection) && ["viewer", "viewer-connecting"].includes(state.role)) {
          showViewerUnavailable("A transmissão foi encerrada ou a conexão caiu.", generation);
        }
      });
      connection.on("error", () => {
        if (isCurrentViewerSession(generation, peer, connection)) {
          showViewerUnavailable("Não foi possível abrir a conexão com o transmissor.", generation);
        }
      });

      window.clearTimeout(state.viewerTimeout);
      state.viewerTimeout = window.setTimeout(() => {
        if (generation === state.viewerGeneration && state.role === "viewer-connecting") {
          showViewerUnavailable("O transmissor não respondeu. Ele pode ter encerrado esta transmissão.", generation);
        }
      }, 15000);
    } catch {
      if (generation === state.viewerGeneration) {
        showViewerUnavailable(
          "Não foi possível alcançar a transmissão. Verifique sua internet e tente novamente.",
          generation,
        );
      }
    } finally {
      if (generation !== state.viewerGeneration) return;
      setButtonLoading(elements.joinBroadcast, false);
      if (state.role === "invite") {
        elements.joinBroadcast.querySelector("span").textContent = "Tentar novamente";
      } else if (state.role === "invite-ended") {
        elements.joinBroadcast.querySelector("span").textContent = "Voltar ao início";
      }
    }
  }

  function isCurrentViewerSession(generation, peer, connection) {
    return (
      generation === state.viewerGeneration &&
      state.peer === peer &&
      state.viewerConnection === connection
    );
  }

  function handleHostMessage(payload, generation, peer, connection) {
    if (!isCurrentViewerSession(generation, peer, connection)) return;
    if (!payload || typeof payload.type !== "string") return;

    if (payload.type === "accepted") {
      setViewerStatus("Convite aceito", "Preparando vídeo e áudio.", "waiting");
      if (payload.actual) updateViewerMeta(payload.actual, payload.audio);
      return;
    }

    if (payload.type === "profile") {
      updateViewerMeta(payload.actual, hasLiveAudio(state.remoteStream));
      showToast(`O transmissor ajustou a qualidade para ${PROFILES[payload.profile?.quality]?.label || "um novo perfil"}.`);
      return;
    }

    if (payload.type === "ended") {
      showViewerEnded("O transmissor encerrou o compartilhamento.", generation);
      return;
    }

    if (payload.type === "rejected") {
      const messages = {
        full: "Esta transmissão atingiu o limite de espectadores configurado pelo transmissor.",
        busy: "O transmissor está recebendo muitas tentativas de conexão. Tente novamente em instantes.",
        duplicate: "Este navegador já está conectado à transmissão.",
        ended: "A transmissão já foi encerrada.",
        invalid: "Este convite não é válido ou expirou.",
        "media-error": "O transmissor não conseguiu enviar o vídeo.",
      };
      showViewerEnded(messages[payload.reason] || "O transmissor recusou esta conexão.", generation);
    }
  }

  function handleIncomingMediaCall(call, generation, peer) {
    if (
      generation !== state.viewerGeneration ||
      state.peer !== peer ||
      !["viewer", "viewer-connecting"].includes(state.role) ||
      !state.pendingInvite ||
      call.peer !== state.pendingInvite.hostId ||
      call.metadata?.app !== "LinkView" ||
      call.metadata?.role !== "host"
    ) {
      call.close();
      return;
    }

    if (state.mediaCall) state.mediaCall.close();
    state.mediaCall = call;
    call.answer();
    call.on("stream", (stream) => receiveRemoteStream(stream, generation, call));
    call.on("close", () => {
      if (generation === state.viewerGeneration && state.mediaCall === call && state.role === "viewer") {
        showViewerUnavailable("O transmissor parou de enviar o vídeo.", generation);
      }
    });
    call.on("error", () => {
      if (generation === state.viewerGeneration && state.mediaCall === call) {
        showViewerUnavailable("A conexão de vídeo foi interrompida.", generation);
      }
    });
  }

  async function receiveRemoteStream(stream, generation, call) {
    if (generation !== state.viewerGeneration || state.mediaCall !== call) {
      stopStream(stream);
      return;
    }
    window.clearTimeout(state.viewerTimeout);
    state.role = "viewer";
    state.remoteStream = stream;
    elements.remoteVideo.srcObject = stream;
    elements.viewerOverlay.hidden = true;
    elements.viewerVideoMeta.hidden = false;
    setViewerLiveState(true, "AO VIVO");
    setViewerStatus("Conectado ao vivo", hasLiveAudio(stream) ? "Vídeo e áudio recebidos." : "Vídeo recebido sem faixa de áudio.", "live");
    updateRemoteVideoMeta();

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack?.addEventListener("ended", () => {
      if (generation === state.viewerGeneration && state.mediaCall === call && state.role === "viewer") {
        showViewerEnded("O transmissor encerrou o compartilhamento.", generation);
      }
    });

    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (generation === state.viewerGeneration && state.mediaCall === call && state.role === "viewer") {
        setViewerStatus("Conectado ao vivo", "O vídeo continua, mas a faixa de áudio foi encerrada.", "live");
        updateRemoteVideoMeta();
      }
    });

    let playbackBlocked = false;
    try {
      await elements.remoteVideo.play();
    } catch {
      playbackBlocked = true;
    }

    if (
      generation !== state.viewerGeneration ||
      state.mediaCall !== call ||
      state.remoteStream !== stream
    ) return;

    if (playbackBlocked) {
      elements.resumePlayback.hidden = false;
      setViewerStatus("Vídeo conectado", "Toque em “Ativar vídeo e áudio” para começar.", "waiting");
    } else {
      elements.resumePlayback.hidden = true;
    }

    window.clearInterval(state.statsTimer);
    state.statsTimer = window.setInterval(() => {
      if (generation === state.viewerGeneration && state.mediaCall === call) updateRemoteVideoMeta();
    }, 2000);
    announce("Transmissão conectada ao vivo.");
  }

  function updateRemoteVideoMeta() {
    const width = elements.remoteVideo.videoWidth;
    const height = elements.remoteVideo.videoHeight;
    const audio = hasLiveAudio(state.remoteStream);
    if (width && height) {
      elements.viewerVideoMeta.textContent = `${width} × ${height} · ${audio ? "com áudio" : "sem áudio"}`;
    } else {
      const settings = getTrackSnapshot(state.remoteStream?.getVideoTracks()[0]);
      updateViewerMeta(settings, audio);
    }
  }

  function updateViewerMeta(actual, audio) {
    if (!actual) return;
    const dimensions = actual.width && actual.height ? `${actual.width} × ${actual.height}` : "Qualidade adaptativa";
    const fps = actual.frameRate ? ` · ${Math.round(actual.frameRate)} FPS` : "";
    elements.viewerVideoMeta.textContent = `${dimensions}${fps} · ${audio ? "com áudio" : "sem áudio"}`;
  }

  async function resumeRemotePlayback() {
    try {
      await elements.remoteVideo.play();
      elements.resumePlayback.hidden = true;
      setViewerStatus("Conectado ao vivo", hasLiveAudio(state.remoteStream) ? "Vídeo e áudio recebidos." : "Vídeo recebido sem faixa de áudio.", "live");
    } catch {
      showToast("O navegador ainda bloqueou a reprodução. Use os controles do vídeo para iniciar.", true);
    }
  }

  async function openFullscreen() {
    const target = elements.remoteVideo;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else if (target.webkitEnterFullscreen) {
        target.webkitEnterFullscreen();
      }
    } catch {
      showToast("A tela cheia não está disponível neste navegador.", true);
    }
  }

  function showViewerUnavailable(message, generation = state.viewerGeneration) {
    if (generation !== state.viewerGeneration) return;
    if (!["viewer", "viewer-connecting"].includes(state.role)) return;
    state.role = "viewer-cleanup";
    cleanupViewerResources(true);
    state.role = "invite";
    elements.viewerOverlay.hidden = false;
    elements.viewerOverlayTitle.textContent = "Transmissor indisponível";
    elements.viewerOverlayCopy.textContent = message;
    elements.joinBroadcast.dataset.action = "join";
    elements.joinBroadcast.querySelector("span").textContent = "Tentar novamente";
    elements.joinBroadcast.disabled = false;
    elements.viewerHome.hidden = false;
    setViewerLiveState(false, "OFFLINE");
    setViewerStatus("Sem conexão", message, "error");
    announce(message);
  }

  function showViewerEnded(message, generation = state.viewerGeneration) {
    if (generation !== state.viewerGeneration) return;
    if (!["viewer", "viewer-connecting"].includes(state.role)) return;
    state.role = "viewer-cleanup";
    cleanupViewerResources(true);
    state.role = "invite-ended";
    elements.viewerOverlay.hidden = false;
    elements.viewerOverlayTitle.textContent = "Transmissão encerrada";
    elements.viewerOverlayCopy.textContent = message;
    elements.joinBroadcast.dataset.action = "home";
    elements.joinBroadcast.querySelector("span").textContent = "Voltar ao início";
    elements.joinBroadcast.disabled = false;
    elements.viewerHome.hidden = true;
    setViewerLiveState(false, "ENCERRADA");
    setViewerStatus("Transmissão encerrada", message, "error");
    announce(message);
  }

  function setViewerStatus(title, copy, type) {
    elements.viewerStatusTitle.textContent = title;
    elements.viewerStatusCopy.textContent = copy;
    elements.viewerConnectionDot.classList.toggle("is-live", type === "live");
    elements.viewerConnectionDot.classList.toggle("is-error", type === "error");
  }

  function setViewerLiveState(live, copy) {
    elements.viewerLiveBadge.classList.toggle("waiting", !live);
    elements.viewerBadgeCopy.textContent = copy;
  }

  function leaveViewer() {
    state.role = "viewer-leaving";
    cleanupViewerResources(false);
    state.pendingInvite = null;
    state.role = "idle";
    stripInviteFromAddressBar();
    showSetup();
  }

  function endBroadcast(origin) {
    if (!["host", "host-starting"].includes(state.role) || state.ending) return;
    state.ending = true;
    state.settingsReturnFocusToMenu = false;
    setSessionMenu(false);
    elements.sessionMenuButton.disabled = true;
    if (elements.settingsDialog.open) elements.settingsDialog.close();

    state.viewers.forEach(({ connection }) => {
      try { connection.send({ type: "ended" }); } catch { /* já encerrada */ }
    });

    elements.hostConnectionBadge.textContent = "Encerrada";
    elements.hostConnectionBadge.classList.add("waiting");
    elements.hostEmpty.hidden = false;
    // Interrompe a mídia imediatamente e dá um instante para a mensagem final
    // atravessar o canal de dados antes de fechar toda a sessão.
    stopStream(state.localStream);
    window.setTimeout(cleanupBroadcastResources, 140);
    announce("Transmissão encerrada.");

    window.setTimeout(() => {
      state.role = "idle";
      state.ending = false;
      showSetup();
      showToast(origin === "browser" ? "O compartilhamento foi encerrado pelo navegador." : "Transmissão encerrada.");
    }, 650);
  }

  function cleanupBroadcastResources() {
    state.hostGeneration += 1;
    window.clearInterval(state.statsTimer);
    state.statsTimer = null;
    state.viewers.forEach((viewer, peerId) => {
      viewer.removed = false;
      removeViewer(peerId, viewer);
    });
    state.viewers.clear();
    state.pendingViewers.forEach((connection) => {
      try { connection.close(); } catch { /* já encerrada */ }
    });
    state.pendingViewers.clear();
    stopStream(state.localStream);
    state.localStream = null;
    elements.localVideo.srcObject = null;
    if (state.peer) {
      try { state.peer.destroy(); } catch { /* já encerrado */ }
    }
    state.peer = null;
    state.hostId = "";
    state.roomToken = "";
    state.shareUrl = "";
  }

  function cleanupViewerResources(preserveInvite) {
    state.viewerGeneration += 1;
    window.clearTimeout(state.viewerTimeout);
    window.clearInterval(state.statsTimer);
    state.viewerTimeout = null;
    state.statsTimer = null;
    try { state.mediaCall?.close(); } catch { /* já encerrada */ }
    try { state.viewerConnection?.close(); } catch { /* já encerrada */ }
    if (state.peer) {
      try { state.peer.destroy(); } catch { /* já encerrado */ }
    }
    state.peer = null;
    state.mediaCall = null;
    state.viewerConnection = null;
    stopStream(state.remoteStream);
    state.remoteStream = null;
    elements.remoteVideo.srcObject = null;
    elements.resumePlayback.hidden = true;
    if (!preserveInvite) state.pendingInvite = null;
  }

  function cleanupAll() {
    if (["host", "host-starting", "host-requesting"].includes(state.role)) {
      state.ending = true;
      state.viewers.forEach(({ connection }) => {
        try { connection.send({ type: "ended" }); } catch { /* sem ação */ }
      });
      cleanupBroadcastResources();
    } else {
      cleanupViewerResources(false);
    }
  }

  function resetToHome() {
    if (["host", "host-starting", "host-requesting"].includes(state.role)) {
      state.ending = true;
      cleanupBroadcastResources();
    } else {
      state.role = "viewer-leaving";
      cleanupViewerResources(false);
    }
    state.role = "idle";
    state.ending = false;
    state.pendingInvite = null;
    stripInviteFromAddressBar();
    showSetup();
  }

  function showSetup() {
    state.settingsReturnFocusToMenu = false;
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    showView("setup");
    elements.hostEmpty.hidden = true;
    elements.startBroadcast.disabled = false;
    elements.startBroadcast.innerHTML = `${screenIcon()}<span>Compartilhar minha tela</span>${arrowIcon()}`;
    elements.watchLink.value = "";
    elements.watchLinkError.hidden = true;
    elements.watchLink.setAttribute("aria-invalid", "false");
  }

  function showView(view) {
    if (view !== "host") setSessionMenu(false);
    elements.sessionMenuButton.hidden = view !== "host";
    elements.sessionMenuButton.disabled = view !== "host" || state.ending;
    elements.setupView.hidden = view !== "setup";
    elements.hostView.hidden = view !== "host";
    elements.viewerView.hidden = view !== "viewer";
    elements.errorView.hidden = view !== "error";
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    const titleByView = {
      setup: $("#setup-title"),
      host: $("#host-title"),
      viewer: $("#viewer-title"),
      error: elements.errorTitle,
    };
    if (state.hasRenderedOnce) {
      window.requestAnimationFrame(() => titleByView[view]?.focus({ preventScroll: true }));
    }
    state.hasRenderedOnce = true;
  }

  function showFatalError(title, copy, retryAction) {
    state.lastRetryAction = retryAction;
    elements.errorTitle.textContent = title;
    elements.errorCopy.textContent = copy;
    elements.retryAction.hidden = typeof retryAction !== "function";
    showView("error");
    announce(`${title}. ${copy}`);
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-error", isError);
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 4200);
  }

  function announce(message) {
    elements.srStatus.textContent = "";
    window.requestAnimationFrame(() => {
      elements.srStatus.textContent = message;
    });
  }

  function setButtonLoading(button, loading, copy = "") {
    button.disabled = loading;
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    if (loading) {
      const textNode = button.querySelector("span");
      if (textNode) textNode.textContent = copy;
      else button.textContent = copy;
    } else {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function getTrackSnapshot(track) {
    if (!track?.getSettings) return {};
    const settings = track.getSettings();
    return {
      width: Number(settings.width) || 0,
      height: Number(settings.height) || 0,
      frameRate: Number(settings.frameRate) || 0,
    };
  }

  function stopStream(stream) {
    stream?.getTracks().forEach((track) => track.stop());
  }

  function hasLiveAudio(stream) {
    return Boolean(stream?.getAudioTracks().some((track) => track.readyState === "live"));
  }

  function createSecret() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function safeTokenEqual(candidate, expected) {
    if (typeof candidate !== "string" || typeof expected !== "string" || candidate.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return difference === 0;
  }

  function buildShareUrl(peerId, token) {
    const url = new URL(window.location.href);
    url.hash = `watch=${encodeURIComponent(peerId)}.${token}`;
    return url.toString();
  }

  function parseInviteHash(hash) {
    if (!hash || hash === "#") return null;
    try {
      const params = new URLSearchParams(hash.slice(1));
      const invite = params.get("watch");
      if (!invite) return null;
      const separatorIndex = invite.lastIndexOf(".");
      if (separatorIndex <= 0) return null;
      const hostId = invite.slice(0, separatorIndex);
      const token = invite.slice(separatorIndex + 1);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId) || !/^[a-f0-9]{32}$/.test(token)) return null;
      return { hostId, token };
    } catch {
      return null;
    }
  }

  function parseInviteInput(input) {
    const value = String(input || "").trim();
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      return parseInviteHash(url.hash);
    } catch {
      return null;
    }
  }

  function stripInviteFromAddressBar() {
    if (!window.location.hash) return;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }

  function screenIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="3"></rect><path d="m8 21 4-3 4 3"></path></svg>';
  }

  function arrowIcon() {
    return '<svg class="arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
  }

  init();
})();
