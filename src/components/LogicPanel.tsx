import Editor from '@monaco-editor/react';
import { Bot, Play, Workflow } from 'lucide-react';
import type { AppCopy } from '../i18n';
import type { LogicBlock, LogicRunPayload, RunState } from '../types';
import { Twin } from './Twin';

const blockPalette: LogicBlock[] = [
  { id: 'forward-5', label: 'Forward steps: 5', kind: 'action' },
  { id: 'rotate-30', label: 'Rotate left: 30deg', kind: 'action' },
  { id: 'condition-obstacle', label: 'If obstacle detected', kind: 'condition' },
  { id: 'stabilize', label: 'Stop and stabilize', kind: 'action' },
];

function makePlacedBlock(template: LogicBlock) {
  return {
    ...template,
    id: `${template.id}-${crypto.randomUUID().slice(0, 6)}`,
  };
}

function buildExecutionGraph(blocks: LogicBlock[], t: AppCopy) {
  const nodes = blocks.map((block, index) => {
    const nextNodeId = blocks[index + 1]?.id ?? null;
    if (block.kind === 'condition') {
      return {
        id: block.id,
        label: block.label || t.conditionNode,
        kind: block.kind,
        next: null,
        onTrue: 'emergency-halt',
        onFalse: nextNodeId,
      };
    }

    return {
      id: block.id,
      label: block.label,
      kind: block.kind,
      next: nextNodeId,
    };
  });

  if (blocks.some((block) => block.kind === 'condition')) {
    nodes.push({
      id: 'emergency-halt',
      label: t.emergencyNode,
      kind: 'action',
      next: null,
    });
  }

  return {
    nodes,
    entryNodeId: nodes[0]?.id ?? null,
  };
}

type LogicPanelProps = {
  t: AppCopy;
  tilt: number;
  runState: RunState;
  activeNodeId: string | null;
  blocks: LogicBlock[];
  code: string;
  onRun: (payload: LogicRunPayload) => void;
  onBlocksChange: (next: LogicBlock[]) => void;
  onCodeChange: (next: string) => void;
};

export function LogicPanel({
  t,
  tilt,
  runState,
  activeNodeId,
  blocks,
  code,
  onRun,
  onBlocksChange,
  onCodeChange,
}: LogicPanelProps) {
  const graph = buildExecutionGraph(blocks, t);

  const addBlock = (template: LogicBlock) => {
    onBlocksChange([...blocks, makePlacedBlock(template)]);
  };

  const moveBlock = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) {
      return;
    }
    const next = [...blocks];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    onBlocksChange(next);
  };

  const resetBlocks = () => onBlocksChange(blockPalette.map((item) => makePlacedBlock(item)));

  return (
    <>
      <div className="logic-header">
        <h2>{t.logicTitle}</h2>
        <p>{t.logicHint}</p>
      </div>

      <div className="logic-layout logic-layout-v3">
        <div className="block-lane">
          <div className="palette-row">
            {blockPalette.map((item) => (
              <button
                key={item.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/palette', JSON.stringify(item))}
                className="palette-item"
                type="button"
              >
                + {item.label}
              </button>
            ))}
            <button type="button" className="palette-item" onClick={resetBlocks}>
              {t.resetBlocks}
            </button>
          </div>

          <div
            className="drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const rawPalette = event.dataTransfer.getData('text/palette');
              if (rawPalette) {
                const template = JSON.parse(rawPalette) as LogicBlock;
                addBlock(template);
              }
            }}
          >
            {blocks.map((block, index) => (
              <div
                key={block.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/reorder', String(index))}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = Number(event.dataTransfer.getData('text/reorder'));
                  if (!Number.isNaN(from)) {
                    moveBlock(from, index);
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                className={`block-item ${activeNodeId === block.id ? 'block-live' : ''} ${
                  runState === 'error' && activeNodeId === block.id ? 'block-error' : ''
                }`}
              >
                <Bot size={15} />
                <span>{block.label}</span>
                {block.kind === 'condition' && <em className="condition-chip">IF</em>}
              </div>
            ))}
          </div>
        </div>

        <div className="graph-lane">
          <div className="graph-header">
            <Workflow size={16} />
            <span>{t.logicGraph}</span>
          </div>
          <div className="graph-list">
            {graph.nodes.map((node) => (
              <div key={node.id} className={`graph-node ${activeNodeId === node.id ? 'graph-live' : ''}`}>
                <div>
                  <strong>{node.label}</strong>
                  <small>{node.kind}</small>
                </div>
                {node.kind === 'condition' ? (
                  <p>
                    {t.branchTrue}: {node.onTrue ?? '-'} | {t.branchFalse}: {node.onFalse ?? '-'}
                  </p>
                ) : (
                  <p>next: {node.next ?? '-'}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="text-lane monaco-lane">
          <Editor
            height="100%"
            defaultLanguage="python"
            value={code}
            theme="vs-dark"
            onChange={(next) => onCodeChange(next ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              smoothScrolling: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontFamily: 'JetBrains Mono',
            }}
          />
        </div>
      </div>

      <div className="logic-actions">
        <button className="run-btn" onClick={() => onRun({ ...graph, sourceCode: code })}>
          {runState === 'loading' ? <span className="loader" /> : <Play size={16} />}
          {runState === 'idle' || runState === 'done' ? t.run : t.running}
        </button>
        {runState === 'error' && <p className="error-inline">{t.collision}</p>}
        <Twin tilt={tilt} small />
      </div>
    </>
  );
}
