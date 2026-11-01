from modules.rag_app import ask, get_graph, new_message_history

get_graph()
print("Ready. Ask Tencent product customer-service questions. Type 'exit' to quit.\n")

message_history = new_message_history()
while True:
    inp = input("Enter question: ").strip()
    if not inp:
        continue
    if inp.lower() == "exit":
        print("Bye.")
        break

    try:
        result = ask(inp, message_history)
    except Exception as e:
        print(f"Error: {e}")
        continue

    print(result["answer"])
    message_history = result["message_history"]
    for src in result["sources"]:
        print(src.get("metadata") or src)
