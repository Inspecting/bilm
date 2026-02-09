(() => {
  const DEFAULT_COUNT = 80;

  function createParticles(canvas, count) {
    const dots = [];
    for (let i = 0; i < count; i += 1) {
      dots.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 1,
        dx: (Math.random() - 0.5) * 0.7,
        dy: (Math.random() - 0.5) * 0.7
      });
    }
    return dots;
  }

  window.bilmParticles = (options = {}) => {
    const { canvasId = 'bgCanvas', count = DEFAULT_COUNT } = options;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dots = [];
    let animationId = null;
    let particlesEnabled = true;
    let motionEnabled = true;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const renderFrame = (shouldMove = true) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c084fc';
      ctx.shadowBlur = 8;
      dots.forEach(dot => {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(193, 132, 252, 0.9)';
        ctx.fill();

        if (shouldMove) {
          dot.x += dot.dx;
          dot.y += dot.dy;

          if (dot.x < 0 || dot.x > canvas.width) dot.dx *= -1;
          if (dot.y < 0 || dot.y > canvas.height) dot.dy *= -1;
        }
      });
      ctx.shadowBlur = 0;
    };

    const animate = () => {
      renderFrame(true);
      animationId = requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };

    const applySettings = (settings) => {
      particlesEnabled = settings?.particles !== false;
      motionEnabled = settings?.motion !== false;
      canvas.style.display = particlesEnabled ? 'block' : 'none';

      stopAnimation();
      if (!particlesEnabled) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      resize();
      dots = createParticles(canvas, count);

      if (motionEnabled) {
        animate();
      } else {
        renderFrame(false);
      }
    };

    window.addEventListener('resize', () => {
      if (!particlesEnabled) return;
      resize();
      dots = createParticles(canvas, count);
      if (!motionEnabled) renderFrame(false);
    });

    window.addEventListener('bilm:theme-changed', (event) => {
      applySettings(event.detail);
    });

    window.addEventListener('DOMContentLoaded', () => {
      applySettings(window.bilmTheme?.getSettings?.());
    });
  };
})();
