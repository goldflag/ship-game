"""Execute the retained aircraft recipe via the installed Blender MCP server.
Run with a Python environment containing mcp, e.g. the blender-mcp tool environment.
The Blender application and its MCP add-on must already be running.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import shutil
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT=Path(__file__).resolve().parents[2]
async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('aircraft',nargs='?',default='all')
    parser.add_argument('--validate',action='store_true',help='Validate and publish each aircraft immediately after MCP export')
    parser.add_argument('--inspect',action='store_true')
    parser.add_argument('--screenshot',type=Path)
    parser.add_argument('--code-file',type=Path)
    args=parser.parse_args()
    server=os.environ.get('BLENDER_MCP_BIN') or shutil.which('blender-mcp')
    if not server:raise SystemExit('Set BLENDER_MCP_BIN to the installed blender-mcp executable.')
    async with stdio_client(StdioServerParameters(command=server)) as (read,write):
        async with ClientSession(read,write) as session:
            await session.initialize()
            available={tool.name for tool in (await session.list_tools()).tools}
            required={'execute_blender_code','get_scene_info','get_viewport_screenshot'}
            if not required<=available:raise RuntimeError('Blender MCP is missing expected authoring/inspection tools')
            async def call(name, params):
                result=await session.call_tool(name,params)
                texts=[c.text for c in result.content if c.type=='text']
                for t in texts:print(t,flush=True)
                if result.isError or any(t.startswith('Error') for t in texts):raise RuntimeError('MCP tool failed')
                return result
            if args.code_file:
                await call('execute_blender_code',{'code':args.code_file.read_text(),'user_prompt':'Inspect and refine original WWII carrier aircraft models'})
            elif not args.inspect and not args.screenshot:
                catalog=json.loads((ROOT/'assets/aircraft/catalog.json').read_text())
                ids=[a['id'] for a in catalog['aircraft']] if args.aircraft=='all' else [args.aircraft]
                for aircraft_id in ids:
                    code='\n'.join(['import os, runpy',f"os.environ['AIRCRAFT_ROOT'] = {str(ROOT)!r}",f"os.environ['AIRCRAFT_ID'] = {aircraft_id!r}",f"os.environ['AIRCRAFT_OUTPUT'] = {str(ROOT/'assets/aircraft'/aircraft_id/'generated')!r}","os.environ['AIRCRAFT_REVIEW'] = '1'","os.environ['AIRCRAFT_METHOD'] = 'blender-mcp'",f"runpy.run_path({str(ROOT/'assets/aircraft/build.py')!r}, run_name='__main__')"])
                    await call('execute_blender_code',{'code':code,'user_prompt':'Create original Japanese and American WWII carrier aircraft using Blender MCP'})
                    if args.validate:
                        process=await asyncio.create_subprocess_exec('bun','run','aircraft:publish',aircraft_id,cwd=ROOT)
                        if await process.wait()!=0:raise RuntimeError('Aircraft export validation failed: '+aircraft_id)
            if args.inspect:await call('get_scene_info',{'user_prompt':'Inspect the authored aircraft scene'})
            if args.screenshot:
                result=await call('get_viewport_screenshot',{'max_size':1600,'user_prompt':'Review original aircraft geometry in the Blender MCP viewport'})
                for c in result.content:
                    if c.type=='image':args.screenshot.parent.mkdir(parents=True,exist_ok=True);args.screenshot.write_bytes(base64.b64decode(c.data))
asyncio.run(main())
