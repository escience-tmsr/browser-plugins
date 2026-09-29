browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "status") {
    const element = document.getElementById("status");
    if (element) {
      element.textContent = msg.text;
    }
  }
});

document.getElementById("startButton").addEventListener("click", () => {
  const doi = document.getElementById("doiInput").value.trim();

  if (!doi) {
    sendStatus("Please enter a DOI.", isError = true);
    return;
  }

  // Progress is shown in the status tab, so the popup can close once the job has
  // started; it stays open to show an error.
  browser.runtime.sendMessage({
    type: "start-job",
    doi
  }).then(() => {
    window.close();
  }).catch(err => {
    sendStatus("Error starting job: " + err, isError = true);
  });

});

// Pressing Enter in the DOI field processes the DOI, like the "Process DOI" button; not
// while an input method is still composing text, where Enter confirms the text.
document.getElementById("doiInput").addEventListener("keydown", (keyEvent) => {
  if (keyEvent.key !== "Enter" || keyEvent.isComposing) return;
  keyEvent.preventDefault();
  document.getElementById("startButton").click();
});

document.getElementById("openStatusTable").addEventListener("click", () => {
  openOrFocusStatusTab().then(() => {
    window.close();
  }).catch(err => {
    sendStatus("Error opening status table: " + err, isError = true);
  });
});

document.getElementById("saveLog").addEventListener("click", () => {
  browser.runtime.sendMessage({
    type: "save-log"
  }).catch(err => { 
    sendStatus("could not save log!"), isError = true
  });
});


function sendStatus(text, isError = false) {
  const element = document.getElementById("status");
  if (!element) return;

  element.textContent = text;
  if (!isError) { console.log("[default-extension] " + text); } 
  else {
    element.style.color = "red";
    console.error("[default-extension] " + text);
  }
}
