console.log("CodeCafe script loaded!");

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("myButton");
  const body = document.body;

  if (button) {
    button.addEventListener("click", () => {
      alert("Button clicked!");
      body.classList.toggle("dark-mode");
      console.log("Dark mode toggled");
    });
  } else {
    console.error("Button element not found!");
  }
});
