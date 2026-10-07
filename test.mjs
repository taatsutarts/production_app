const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.NVIDIA_API_KEY,
  },
  body: JSON.stringify({
    model: "meta/llama-3.2-90b-vision-instruct",
    messages: [{ role: "user", content: "Say hello in one word" }],
    max_tokens: 20,
  }),
});
console.log(res.status, await res.text());