try { document.documentElement.dataset.theme = localStorage.getItem('cs_theme') || 'light'; } catch (e) { document.documentElement.dataset.theme = 'light'; }
