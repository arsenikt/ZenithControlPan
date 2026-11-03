import { Braces, CheckCircle2, Code2, Cpu, FileCode2, LoaderCircle, Play, Rocket, ShieldCheck, Sparkles, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { ContractDefinition, ControlSnapshot } from '../types'
import { errorMessage, parseArguments } from '../utils'

const starter = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ZenithMessageBoard {
    address public immutable owner;
    string public message;
    uint256 public updates;

    event MessageUpdated(address indexed author, string message, uint256 updates);

    constructor(string memory initialMessage) {
        owner = msg.sender;
        message = initialMessage;
    }

    function updateMessage(string calldata nextMessage) external {
        require(msg.sender == owner, "owner only");
        require(bytes(nextMessage).length <= 160, "message too long");
        message = nextMessage;
        updates += 1;
        emit MessageUpdated(msg.sender, nextMessage, updates);
    }
}`

export function StudioPage({ snapshot, onRefresh, notify }: { snapshot: ControlSnapshot | null; onRefresh: () => Promise<void>; notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void }) {
  const [source, setSource] = useState(starter)
  const [name, setName] = useState('ZenithMessageBoard')
  const [artifact, setArtifact] = useState<ContractDefinition | null>(null)
  const [constructorArgs, setConstructorArgs] = useState('["Hello, Zenith!"]')
  const [busy, setBusy] = useState<'compile' | 'deploy' | null>(null)
  const [errors, setErrors] = useState('')

  const compile = async () => {
    setBusy('compile'); setErrors(''); setArtifact(null)
    try {
      const result = await window.zenithControl.studio.compile(source, name)
      setArtifact(result)
      notify('success', 'Компиляция успешна', `${result.contractName} · ${(result.bytecodeBytes / 1024).toFixed(1)} KB`)
      await onRefresh()
    } catch (error) { const message = errorMessage(error); setErrors(message); notify('error', 'Solidity compile error', message.split('\n')[0]) }
    finally { setBusy(null) }
  }

  const deploy = async () => {
    if (!artifact) return
    setBusy('deploy')
    try {
      const record = await window.zenithControl.contracts.deploy(artifact.key, parseArguments(constructorArgs))
      notify('success', 'Custom contract задеплоен', record.address)
      await onRefresh()
    } catch (error) { notify('error', 'Deployment не выполнен', errorMessage(error)) }
    finally { setBusy(null) }
  }

  return <div className="page-content studio-page">
    <section className="studio-intro card"><div><span><Sparkles /></span><div><span className="section-kicker">SELF-CONTAINED SOLIDITY</span><h2>Создавайте контракты рядом с production suite.</h2><p>Встроенный solc компилирует один файл без imports, сохраняет ABI и bytecode локально, после чего контракт появляется в Deployments и ABI Console.</p></div></div><div className="studio-badges"><span><ShieldCheck /> Local compiler</span><span><Cpu /> Optimizer 200</span><span><Braces /> EVM Cancun</span></div></section>
    <section className="studio-workbench">
      <div className="source-editor card"><header><div><FileCode2 /><span><strong>Custom.sol</strong><small>Solidity 0.8.30</small></span></div><label>CONTRACT <input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} /></label></header><div className="editor-body"><div className="line-numbers">{source.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} /></div><footer><span>{source.split('\n').length} lines · {new Blob([source]).size} bytes</span><button className="button primary" type="button" onClick={() => void compile()} disabled={busy !== null}>{busy === 'compile' ? <LoaderCircle className="spin" /> : <Play />} Compile contract</button></footer></div>
      <aside className="compile-panel card"><header><Terminal /><div><span className="section-kicker">COMPILER OUTPUT</span><h3>Artifact inspector</h3></div></header>{errors ? <div className="compiler-error"><strong>COMPILATION FAILED</strong><pre>{errors}</pre></div> : artifact ? <div className="artifact-result"><div className="compile-success"><CheckCircle2 /><div><strong>Build successful</strong><p>{artifact.contractName}</p></div></div><dl><div><dt>ARTIFACT KEY</dt><dd>{artifact.key}</dd></div><div><dt>BYTECODE</dt><dd>{(artifact.bytecodeBytes / 1024).toFixed(2)} KB</dd></div><div><dt>FUNCTIONS</dt><dd>{artifact.functions.length}</dd></div><div><dt>EVENTS</dt><dd>{artifact.events.length}</dd></div><div><dt>COMPILER</dt><dd>{artifact.compiler.split('+')[0]}</dd></div></dl><div className="abi-preview"><span>ABI SURFACE</span>{artifact.functions.slice(0, 7).map((item) => <code key={item.signature}>{item.readOnly ? 'read' : 'write'} · {item.signature}</code>)}</div><label className="code-field"><span>CONSTRUCTOR ARGUMENTS</span><textarea value={constructorArgs} onChange={(event) => setConstructorArgs(event.target.value)} rows={3} spellCheck={false} /></label><button className="button primary full" type="button" onClick={() => void deploy()} disabled={busy !== null || !snapshot?.deployer}>{busy === 'deploy' ? <LoaderCircle className="spin" /> : <Rocket />} Deploy custom artifact</button>{!snapshot?.deployer && <p className="field-warning">Сначала настройте deployer wallet.</p>}</div> : <div className="compiler-empty"><Code2 /><strong>Ожидает компиляции</strong><p>Artifact metadata, ABI и constructor schema появятся здесь.</p></div>}</aside>
    </section>
    <section className="studio-guidance"><article className="card"><span>01</span><div><strong>Self-contained source</strong><p>Скопируйте зависимости в один файл. Imports намеренно отключены для воспроизводимой локальной сборки.</p></div></article><article className="card"><span>02</span><div><strong>Review bytecode</strong><p>Проверьте ABI surface и размер до подписи deployment-транзакции.</p></div></article><article className="card"><span>03</span><div><strong>Operate through ABI</strong><p>После deployment custom contract автоматически доступен в разделе «Управление».</p></div></article></section>
  </div>
}
