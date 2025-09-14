// popup.js - inject content.js into the active tab, then message it
const selectBtn = document.getElementById("start-btn");
const statusMessage = document.getElementById("status-message");
const listDiv = document.getElementById("replacements-list");

function showStatus(msg, isError=false) {
  statusMessage.textContent = msg;
  statusMessage.style.color = isError ? "red" : "green";
}

// Load the replacement list (optional UI)
function loadList(){
  chrome.storage.sync.get(['replacements'], (data) => {
    const rules = data.replacements || [];
    listDiv.innerHTML = '';
    if (rules.length === 0) {
      listDiv.innerHTML = '<div style="color:#7f8c8d">No replacements set.</div>';
    } else {
      rules.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'rule';
        const txt = document.createElement('div');
        txt.textContent = `\"${r.original}\" → \"${r.replacement}\"`;
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', () => deleteRule(i));
        row.appendChild(txt);
        row.appendChild(del);
        listDiv.appendChild(row);
      });
    }
  });
}

function deleteRule(index){
  chrome.storage.sync.get(['replacements'], (data) => {
    let rules = data.replacements || [];
    if (index >= 0 && index < rules.length) {
      rules.splice(index, 1);
      chrome.storage.sync.set({ replacements: rules }, () => {
        loadList();
        showStatus("Rule deleted.");
        // notify tabs to refresh
        chrome.tabs.query({}, tabs => {
          for (const t of tabs) {
            chrome.tabs.sendMessage(t.id, { action: 'refreshReplacements' }, () => {});
          }
        });
      });
    }
  });
}

// MAIN: when user clicks Select
selectBtn.addEventListener('click', async () => {
  showStatus("Preparing selection mode...");
  // get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      showStatus("No active tab found.", true);
      return;
    }

    // First try to inject content.js into the tab (this will load it into the main frame)
    try {
      // Use chrome.scripting (MV3) to inject the file
      await new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id, allFrames: false },
            files: ['content.js']
          },
          (injectionResults) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(injectionResults);
          }
        );
      });

      // After injection attempt, send message to start selection
      chrome.tabs.sendMessage(tab.id, { action: 'startSelection' }, (resp) => {
        if (chrome.runtime.lastError) {
          // If still fails, report the underlying error
          showStatus("Error: " + chrome.runtime.lastError.message, true);
        } else if (resp && resp.ok) {
          showStatus("Selection mode enabled. Click text on the page.");
          // auto-close popup if desired:
          // window.close();
        } else {
          showStatus("No response from page after injection.", true);
        }
      });
    } catch (err) {
      // Injection failed (CSP or extension blocked)
      showStatus("Injection failed: " + err.message, true);
    }
  });
});

// keep UI list updated
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.replacements) loadList();
});

document.addEventListener('DOMContentLoaded', () => {
  loadList();
});
