"""Save to disk the images returned by the OpenRouter MCP tool generate-image in a Claude Code session (the tool only
shows them; Claude Code keeps them, base64, in the session transcript ~/.claude/projects/*/<session>.jsonl).
Usage: python art-src/ai3d/grab_mcp_images.py <out_dir> [session_id]   (default: the most recent transcript)
Writes <out_dir>/gen_<n>.png, n = order of the generate-image calls in the session, and prints each prompt."""
import base64, glob, io, json, os, sys
from PIL import Image

out_dir = sys.argv[1]
pattern = f'*/{sys.argv[2]}.jsonl' if len(sys.argv) > 2 else '*/*.jsonl'
transcript = max(glob.glob(os.path.join(os.path.expanduser('~/.claude/projects'), pattern)), key=os.path.getmtime)
os.makedirs(out_dir, exist_ok=True)
calls, n = {}, 0
for line in open(transcript, encoding='utf-8'):
    content = json.loads(line).get('message', {}).get('content')
    if not isinstance(content, list):
        continue
    for part in content:
        if part.get('type') == 'tool_use' and part.get('name', '').endswith('generate-image'):
            calls[part['id']] = part.get('input', {}).get('prompt', '')
        elif part.get('type') == 'tool_result' and part.get('tool_use_id') in calls:
            for sub in part.get('content') or []:
                if isinstance(sub, dict) and sub.get('type') == 'image':
                    n += 1
                    out = os.path.join(out_dir, f'gen_{n}.png')
                    Image.open(io.BytesIO(base64.b64decode(sub['source']['data']))).convert('RGB').save(out)
                    print(out, '|', calls[part['tool_use_id']][-120:].replace('\n', ' '))
print(n, 'images from', transcript)
