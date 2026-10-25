import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { texturedAvatarFixture } from '../fixtures/avatar';

test('paused WebGL redraws model import and reset without resuming animation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-paused-render-probe-'));
  const glb = join(directory, 'synthetic.glb'); await writeFile(glb, texturedAvatarFixture().bytes);
  const env = Object.fromEntries(Object.entries(process.env).filter((p): p is [string, string] => typeof p[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ chromiumSandbox: true, env, args: ['.', '--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${join(directory, 'profile')}`] });
  try {
    const page = await app.firstWindow(); await page.getByRole('button', {name:'3D 면접관',exact:true}).click();
    const canvas = page.locator('.avatar-viewport canvas');
    await expect(canvas).toHaveAttribute('data-studio-ready','true');
    await expect(page.getByText('모델 검증·복원 중입니다.',{exact:true})).toHaveCount(0);
    await expect.poll(async()=>Number(await canvas.getAttribute('data-fps'))).toBeGreaterThan(0);
    await page.getByLabel('움직임 일시정지').check(); await expect(canvas).toHaveAttribute('data-paused','true');
    async function pixels(){return canvas.evaluate(async c=>{await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const gl=(c as HTMLCanvasElement).getContext('webgl2')!;const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);let hash=2166136261;const colors=new Set<string>();for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){const i=(y*w+x)*4;colors.add(`${p[i]},${p[i+1]},${p[i+2]}`);for(let k=0;k<3;k++)hash=Math.imul(hash^p[i+k]!,16777619)>>>0;}return{hash,colors:colors.size};});}
    const before=await pixels();
    expect(before.colors).toBeGreaterThan(20);
    await page.getByText('면접관 모델 설정',{exact:true}).click();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},glb);
    await page.getByRole('button',{name:'A 모델 불러오기',exact:true}).click();
    await expect(page.locator('.avatar-models article').first()).toContainText('synthetic.glb');
    const afterImport=await pixels();
    expect(afterImport.hash,'model import must visibly redraw without unpausing or moving camera').not.toBe(before.hash);
    expect(await pixels()).toEqual(afterImport);
    await page.screenshot({path:'test-results/avatar-paused-imported.png',fullPage:true});
    await page.getByRole('button',{name:'A 기본 모델',exact:true}).click();
    await expect(page.locator('.avatar-models article').first()).toContainText('기본 3D 캐릭터');
    const afterReset=await pixels();
    expect(afterReset.hash).not.toBe(afterImport.hash);
    expect(afterReset.colors).toBeGreaterThan(20);
    expect(await pixels()).toEqual(afterReset);
    await page.getByLabel('렌더링 품질').selectOption('standard');
    await expect(page.getByLabel('렌더링 품질')).toBeEnabled();
    const afterQuality=await pixels();
    expect(afterQuality.colors,'quality change must keep the scene visible while paused').toBeGreaterThan(20);
    await expect(canvas).toHaveAttribute('data-paused','true');
  } finally {await app.close();await rm(directory,{recursive:true,force:true});}
});
