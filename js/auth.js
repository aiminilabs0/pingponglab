// ════════════════════════════════════════════════════════════
//  Admin toggle via © symbol
// ════════════════════════════════════════════════════════════

function initAuth() {
    const toggle = document.getElementById('adminToggle');
    if (!toggle) return;

    function updateAdminStyle() {
        toggle.classList.toggle('admin-active', localStorage.getItem('admin') !== null);
    }
    updateAdminStyle();
    toggle.addEventListener('click', () => {
        if (localStorage.getItem('admin') !== null) {
            localStorage.removeItem('admin');
        } else {
            localStorage.setItem('admin', '1');
        }
        updateAdminStyle();
    });
}
