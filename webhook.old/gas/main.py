import functions_framework

@functions_framework.http
def hello_get(request):
    name = request.args.get("name", "World")
    return f"Hello, {name}!"
