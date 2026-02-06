const navbarScript = document.createElement('script');
navbarScript.src = '/bilm/shared/navbar.js';
navbarScript.defer = true;
navbarScript.onerror = (error) => {
  console.error('Failed to load navbar:', error);
};
document.body.appendChild(navbarScript);
