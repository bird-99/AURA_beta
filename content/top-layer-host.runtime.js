(() => {
  const HOST_ATTR = 'data-aura-top-layer-host';
  const HOST_VERSION = 'v1';
  const OVERLAY_ATTR = 'data-aura-top-layer-overlay';
  const CONTROLS_ATTR = 'data-aura-top-layer-controls';
  const DEFAULT_Z_INDEX = 2147483647;

  function resolveMountParent(doc) {
    return doc?.documentElement || doc?.body || null;
  }

  function getExistingHost(doc) {
    if (!doc?.querySelector) return null;
    try {
      return doc.querySelector(`[${HOST_ATTR}="${HOST_VERSION}"]`);
    } catch (error) {
      return null;
    }
  }

  function buildRoot(doc, zIndex) {
    const root = doc?.createElement?.('div');
    if (!root) {
      throw new Error('Cannot create top layer host without a document');
    }

    root.setAttribute(HOST_ATTR, HOST_VERSION);
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.zIndex = String(zIndex ?? DEFAULT_Z_INDEX);
    root.style.pointerEvents = 'none';
    root.style.display = 'block';
    root.style.contain = 'layout style paint';

    const overlayRoot = doc.createElement('div');
    overlayRoot.setAttribute(OVERLAY_ATTR, '');
    overlayRoot.style.position = 'fixed';
    overlayRoot.style.inset = '0';
    overlayRoot.style.pointerEvents = 'none';
    overlayRoot.style.display = 'block';

    const controlsRoot = doc.createElement('div');
    controlsRoot.setAttribute(CONTROLS_ATTR, '');
    controlsRoot.style.position = 'fixed';
    controlsRoot.style.inset = '0';
    controlsRoot.style.pointerEvents = 'none';
    controlsRoot.style.display = 'block';
    controlsRoot.style.zIndex = String((zIndex ?? DEFAULT_Z_INDEX) + 1);

    root.appendChild(overlayRoot);

    return { root, overlayRoot, controlsRoot };
  }

  function createTopLayerHost(options = {}) {
    const doc = options?.doc || document;
    const existing = getExistingHost(doc);

    let root = null;
    let overlayRoot = null;
    let controlsRoot = null;
    let mounted = false;

    if (existing) {
      root = existing;
      overlayRoot = existing.querySelector?.(`[${OVERLAY_ATTR}]`) || null;
      controlsRoot = doc.querySelector?.(`[${CONTROLS_ATTR}]`) || null;
    }

    if (!root || !overlayRoot || !controlsRoot) {
      const built = buildRoot(doc, options?.zIndex ?? DEFAULT_Z_INDEX);
      root = built.root;
      overlayRoot = built.overlayRoot;
      controlsRoot = built.controlsRoot;
    }

    const mount = () => {
      if (mounted) return;
      const parent = resolveMountParent(doc);
      if (!parent) return;
      if (!root.isConnected) {
        parent.appendChild(root);
      }
      if (controlsRoot && !controlsRoot.isConnected) {
        parent.appendChild(controlsRoot);
      }
      mounted = true;
    };

    const unmount = () => {
      if (!mounted) return;
      try {
        root.remove();
      } catch (error) {
        // ignore unmount errors
      }
      try {
        controlsRoot?.remove?.();
      } catch (error) {
        // ignore unmount errors
      }
      mounted = false;
    };

    const setVisible = (visible) => {
      if (!root) return;
      root.style.display = visible ? 'block' : 'none';
      if (controlsRoot) {
        controlsRoot.style.display = visible ? 'block' : 'none';
      }
    };

    return {
      mount,
      unmount,
      setVisible,
      getOverlayRoot: () => overlayRoot,
      getControlsRoot: () => controlsRoot,
    };
  }

  globalThis.AURA_TOP_LAYER_HOST = Object.freeze({
    createTopLayerHost,
  });
})();
