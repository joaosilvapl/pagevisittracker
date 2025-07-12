// Changed from limitSeconds to minutesSinceLastVisit
const DEFAULT_TRACKED_PAGES = [{ url: 'https://www.bbc.com/', minutesSinceLastVisit: 5 }];

let trackedPages = [];

function createTrackedPageRow(page = { url: '', minutesSinceLastVisit: 5 }, index) {
    const container = document.getElementById('trackedPagesContainer');
    if (!container) {
        console.error("Error: 'trackedPagesContainer' not found in options.html");
        return;
    }

    const itemDiv = document.createElement('div');
    itemDiv.className = 'tracked-item';
    itemDiv.dataset.index = index;

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'https://example.com/';
    urlInput.value = page.url;
    urlInput.className = 'url-input';
    urlInput.addEventListener('input', (event) => updateTrackedPageData(index, 'url', event.target.value));

    const minutesInput = document.createElement('input'); // Changed name
    minutesInput.type = 'number';
    minutesInput.min = '1';
    minutesInput.placeholder = 'Minutes';
    minutesInput.value = page.minutesSinceLastVisit; // Changed property
    minutesInput.className = 'minutes-input';
    minutesInput.addEventListener('input', (event) => updateTrackedPageData(index, 'minutesSinceLastVisit', parseInt(event.target.value) || 0)); // Changed property

    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => removeTrackedPageRow(index));

    itemDiv.appendChild(document.createTextNode('URL: '));
    itemDiv.appendChild(urlInput);
    itemDiv.appendChild(document.createTextNode(' Minutes Since Last Visit: ')); // Changed label
    itemDiv.appendChild(minutesInput); // Changed input variable
    itemDiv.appendChild(removeButton);

    container.appendChild(itemDiv);
}

function updateTrackedPageData(index, field, value) {
    if (index >= 0 && index < trackedPages.length) {
        trackedPages[index][field] = value;
    }
}

function addTrackedPageRow() {
    trackedPages.push({ url: '', minutesSinceLastVisit: 5 }); // Changed default
    renderTrackedPages();
}

function removeTrackedPageRow(indexToRemove) {
    trackedPages.splice(indexToRemove, 1);
    if (trackedPages.length === 0) {
        trackedPages.push({ url: DEFAULT_TRACKED_PAGES[0].url, minutesSinceLastLastVisit: DEFAULT_TRACKED_PAGES[0].minutesSinceLastVisit });
    }
    renderTrackedPages();
}

function renderTrackedPages() {
    const container = document.getElementById('trackedPagesContainer');
    if (!container) {
        console.error("Error: 'trackedPagesContainer' not found for rendering.");
        return;
    }
    container.innerHTML = '';

    trackedPages.forEach((page, index) => {
        createTrackedPageRow(page, index);
    });

    const status = document.getElementById('statusMessage');
    if (status) {
        status.textContent = '';
    }
}

function saveOptions() {
    const cleanedPages = trackedPages.map(page => {
        let url = page.url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://') && url !== '') {
            url = 'https://' + url;
        }
        if (!url.endsWith('/') && url !== '') {
            url += '/';
        }
        let minutes = parseInt(page.minutesSinceLastVisit) || 5; // Changed property and default
        if (minutes < 1) minutes = 1;
        return { url: url, minutesSinceLastVisit: minutes }; // Changed property
    }).filter(page => page.url !== '');

    if (cleanedPages.length === 0) {
        cleanedPages.push({ url: DEFAULT_TRACKED_PAGES[0].url, minutesSinceLastVisit: DEFAULT_TRACKED_PAGES[0].minutesSinceLastVisit }); // Changed property
    }

    chrome.storage.sync.set({
        trackedPages: cleanedPages
    }, () => {
        trackedPages = cleanedPages;
        renderTrackedPages();

        const status = document.getElementById('statusMessage');
        if (status) {
            status.textContent = 'Settings saved!';
            setTimeout(() => {
                status.textContent = '';
            }, 2000);
        }
    });
}

function restoreOptions() {
    chrome.storage.sync.get({
        trackedPages: DEFAULT_TRACKED_PAGES
    }, (items) => {
        trackedPages = items.trackedPages;
        if (trackedPages.length === 0) {
            trackedPages.push({ url: DEFAULT_TRACKED_PAGES[0].url, minutesSinceLastVisit: DEFAULT_TRACKED_PAGES[0].minutesSinceLastVisit });
        }
        renderTrackedPages();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addPageButton').addEventListener('click', addTrackedPageRow);
    document.getElementById('saveAllButton').addEventListener('click', saveOptions);

    restoreOptions();
});