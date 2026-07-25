import requests

LLM_URL = "http://172.16.65.13:5000/completion"

with open("lecture.txt", "r") as f:
    lecture_text = f.read()

prompt = f"""
Summarize the following lecture clearly and concisely:

{lecture_text}
"""

payload = {
    "prompt": prompt,
    "n_predict": 512,
    "temperature": 0.3
}

response = requests.post(LLM_URL, json=payload)

result = response.json()["content"]

with open("response.txt", "w") as f:
    f.write(result)

print("Response saved to response.txt")
