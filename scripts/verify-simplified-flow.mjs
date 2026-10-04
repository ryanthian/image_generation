/** Real browser fixture dry run. Does not write Sheets or publish to Facebook. */
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.CONSOLE_BASE_URL||'http://127.0.0.1:4173';
const output=process.env.CONSOLE_QA_OUTPUT||'output/playwright/simplification-local';
await mkdir(output,{recursive:true});
let authorization;
if(process.env.CONSOLE_AUTH_STDIN){let input='';for await(const chunk of process.stdin)input+=chunk;authorization=JSON.parse(input).authorization;}
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,extraHTTPHeaders:authorization?{'OAI-Sites-Authorization':authorization}:{}});
const page=await context.newPage(),errors=[],writes=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
page.on('request',request=>{if(request.method()!=='GET')writes.push({method:request.method(),path:new URL(request.url()).pathname});});
try{
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#platformStatus')?.textContent==='PRODUCTION READY',{},{timeout:60000});
 assert.equal(await page.locator('#workReviewer').count(),0);assert.equal(await page.locator('#editorReviewer').count(),0);
 const counts=await page.locator('#sheetSelect option').allTextContents();assert.ok(counts.some(s=>s.includes('120 records')));assert.ok(counts.some(s=>s.includes('100 records')));assert.ok(counts.some(s=>s.includes('70 records')));
 for(const item of [{sheetId:'2026091901',contentId:'EN-NEW-009',kind:'Recipe'},{sheetId:'433728120',contentId:'GS-V4-SG-002',kind:'Selection Guide'}]){
   await page.locator('#sheetSelect').selectOption(item.sheetId);await page.waitForFunction(id=>document.querySelector('#recipeSelect option[value="'+id+'"]'),item.contentId);
   await page.locator('#recipeSelect').selectOption(item.contentId);await page.waitForFunction(id=>document.querySelector('#contentId').textContent===id&&document.querySelectorAll('#slots .slot').length>0,item.contentId);
   await page.waitForFunction(()=>document.querySelector('#recommendation').textContent==='PRODUCE');
   await page.locator('#autoImprove').click();await page.waitForFunction(()=>document.querySelector('#recommendation').textContent==='PRODUCE');
   await page.locator('#primaryAction').click();assert.ok(page.url().endsWith('#images'));
   await page.locator('#copyMaster').click();await page.locator('#copyNextPrompt').click();
   const slotNames=await page.locator('#slots .image-facts').allTextContents(),files=[];
   for(let i=0;i<slotNames.length;i++){
     const name=slotNames[i].split(/\s/)[0],path=`${output}/${item.contentId}-${name}`;
     const bytes=await page.evaluate(index=>{const c=document.createElement('canvas');c.width=1440;c.height=1800;const x=c.getContext('2d');x.fillStyle=`hsl(${index*41},35%,65%)`;x.fillRect(0,0,c.width,c.height);x.fillStyle='#333';x.font='48px sans-serif';x.fillText('SYNTHETIC TEST FIXTURE '+index,160,700);return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),ch=>ch.charCodeAt(0)));},i);
     // Deterministic sequence must remain at the beginning, filename token after it.
     const filePath=`${output}/${name.replace('.png',`_fixture_${item.contentId}.png`)}`;await writeFile(filePath,Buffer.from(bytes));files.push(filePath);
   }
   await page.locator('#allFiles').setInputFiles(files.reverse());await page.waitForFunction(n=>document.querySelectorAll('#slots .slot.ready').length===n,files.length,{timeout:45000});
   await page.reload();await page.waitForFunction(id=>document.querySelector('#contentId')?.textContent===id,item.contentId);await page.waitForFunction(n=>document.querySelectorAll('#slots .slot.ready').length===n,files.length);
   await page.waitForFunction(n=>document.querySelector('#resumeHint').textContent.includes(`${n}/${n}`),files.length,{timeout:15000});const resume=await page.locator('#resumeHint').textContent();assert.ok(resume.includes(`${files.length}/${files.length}`));
   await page.locator('#imageBuild').click();await page.waitForFunction(()=>!document.querySelector('#looksGood').disabled,{},{timeout:60000});
   assert.ok(await page.locator('#finalImage').isVisible());await page.locator('#previewNext').click();await page.locator('#looksGood').click();await page.waitForFunction(()=>!document.querySelector('#downloadPost').disabled);
   const downloadPromise=page.waitForEvent('download');await page.locator('#downloadPost').click();const download=await downloadPromise;const zipPath=`${output}/${item.contentId}.zip`;await download.saveAs(zipPath);
   const finalCount=(await page.locator('#previewPosition').textContent()).split('/')[1].trim();
   const markPosted=await page.locator('#markPosted').isDisabled();assert.equal(markPosted,true);
   // Replacing one image invalidates the final decision and export; rebuild keeps unaffected asset revisions.
   const assetTimes=await page.evaluate(async()=>{const open=indexedDB.open('content-ai-production-console-v1',1);const db=await new Promise(r=>open.onsuccess=()=>r(open.result));const tx=db.transaction('assets','readonly'),store=tx.objectStore('assets'),keys=store.getAllKeys(),values=store.getAll();const result=await new Promise(r=>tx.oncomplete=()=>r(Object.fromEntries(keys.result.map((k,i)=>[k,values.result[i].updatedAt]))));db.close();return result;});
   await page.locator('#allFiles').setInputFiles([files[0]]);await page.waitForFunction(()=>document.querySelector('#downloadPost').disabled);
   await page.locator('#rebuildFinal').click();await page.waitForFunction(()=>!document.querySelector('#looksGood').disabled);
   const changedAssets=await page.evaluate(async({before,prefix})=>{const open=indexedDB.open('content-ai-production-console-v1',1);const db=await new Promise(r=>open.onsuccess=()=>r(open.result));const tx=db.transaction('assets','readonly'),store=tx.objectStore('assets'),keys=store.getAllKeys(),values=store.getAll();const result=await new Promise(r=>tx.oncomplete=()=>r(keys.result.filter((k,i)=>k.startsWith(prefix)&&before[k]!==values.result[i].updatedAt)));db.close();return result;},{before:assetTimes,prefix:`${item.sheetId}:${item.contentId}:`});assert.equal(changedAssets.length,1,'Rebuild only the asset affected by the replaced image');
   results.push({...item,selectiveRebuild:true,slots:files.length,finalPages:Number(finalCount),resume:true,zipPath,staleExportBlocked:true,markPostedBlocked:true,humanApproval:'NOT GRANTED',realImageValidation:'SYNTHETIC FIXTURES ONLY'});
 }
 await page.locator('#editorialQueue > summary').click();await page.locator('#queueFilter').selectOption('BATCH 01');assert.equal(await page.locator('#queueRows tr').count(),20);
 await page.locator('#queueFilter').selectOption('SKIP');await page.locator('#queueShowDuplicates').check();assert.ok((await page.locator('#queueRows').textContent()).includes('Duplicate'));
 await page.locator('#workNext').click();assert.ok(await page.locator('#contentId').textContent());
 await page.setViewportSize({width:390,height:844});await page.locator('#recipe').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/mobile.png`});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'Mobile must not overflow');
 await page.locator('#showOriginal').click();assert.ok(await page.locator('.original-pane').isVisible());assert.equal(await page.locator('.optimised-pane').isVisible(),false);await page.locator('#showOptimised').click();assert.ok(await page.locator('.optimised-pane').isVisible());
 assert.equal(writes.length,0,JSON.stringify(writes));assert.deepEqual(errors,[]);
 const report={base,counts,results,mobile:{width:390,height:844,overflow:false,tabs:true},batchCount:20,consoleErrors:errors,nonGetRequests:writes,passed:true};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({message:error.message,errors,contentId:await page.locator('#contentId').textContent(),resume:await page.locator('#resumeHint').textContent(),persistentError:await page.locator('#persistentError').textContent()}));throw error;}finally{await browser.close();}
