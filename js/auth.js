// ════════════════════════════════════════════════════════════
//  Simple name-based Auth (localStorage, non-blocking)
// ════════════════════════════════════════════════════════════

const AUTH_STORAGE_KEY = 'pingponglab_user_id';

function getLoggedInUser() {
    return localStorage.getItem(AUTH_STORAGE_KEY);
}

function initAuth() {
    const loginSection = document.getElementById('headerLogin');
    const badge = document.getElementById('userBadge');
    const input = document.getElementById('loginNameInput');
    const nameEl = document.getElementById('userBadgeName');
    const logoutBtn = document.getElementById('userLogoutBtn');

    function showLoggedIn(name) {
        nameEl.textContent = name;
        loginSection.hidden = true;
        badge.hidden = false;
    }

    function showLoggedOut() {
        loginSection.hidden = false;
        badge.hidden = true;
        input.value = '';
    }

    const saved = getLoggedInUser();
    if (saved) {
        showLoggedIn(saved);
    } else {
        showLoggedOut();
    }

    function doLogin() {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        localStorage.setItem(AUTH_STORAGE_KEY, name);
        showLoggedIn(name);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        showLoggedOut();
    });
}
