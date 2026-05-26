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

  browser.runtime.sendMessage({
    type: "start-job",
    doi
  }).catch(err => {
    sendStatus("Error starting job: " + err, isError = true);
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
