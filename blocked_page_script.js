document.addEventListener('DOMContentLoaded', () => {
    const closePageButton = document.getElementById('closePageButton');
    const letMeInButton = document.getElementById('letMeInButton');

    // Get the originalUrl from the URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const originalUrl = urlParams.get('originalUrl');

    if (closePageButton) {
        closePageButton.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "close_current_tab_from_blocked_page" });
        });
    }

    if (letMeInButton) {
        letMeInButton.addEventListener('click', () => {
            // Send the original URL back to the background script
            chrome.runtime.sendMessage({ type: "allow_access_to_url", url: originalUrl });
        });
    }
});