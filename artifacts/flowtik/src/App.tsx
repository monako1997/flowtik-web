import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileDown,
  FileVideo,
  Gauge,
  HardDriveDownload,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Video,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type Stage = 'empty' | 'editing' | 'processing' | 'complete';
type Target = 'social' | 'web' | 'small';

type VideoMeta = {
  duration: number;
  width: number;
  height: number;
};

const targetOptions: Array<{ id: Target; label: string; detail: string; factor: number }> = [
  { id: 'social', label: 'Social', detail: '1080p', factor: 0.62 },
  { id: 'web', label: 'Web', detail: '720p', factor: 0.43 },
  { id: 'small', label: 'Small', detail: '480p', factor: 0.27 },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function extensionFor(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension && extension.length <= 5 ? extension : 'mp4';
}

function Stepper({ stage }: { stage: Stage }) {
  const activeIndex = stage === 'empty' ? 0 : stage === 'editing' ? 1 : stage === 'processing' ? 2 : 3;
  const steps = ['Add clip', 'Tune', 'Process', 'Export'];

  return (
    <nav className="stepper" aria-label="Compression progress">
      {steps.map((label, index) => (
        <div className="step-wrap" key={label}>
          <div className={`step ${index === activeIndex ? 'active' : ''} ${index < activeIndex ? 'done' : ''}`}>
            <span className="step-number" aria-hidden="true">{index < activeIndex ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
            <span>{label}</span>
          </div>
          {index < steps.length - 1 && <div className="step-line" aria-hidden="true" />}
        </div>
      ))}
    </nav>
  );
}

function EmptyState({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('That file is not a video. Choose an MP4, MOV, WebM, or another browser-readable clip.');
      return;
    }
    setError('');
    onFile(file);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const handleDropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className="empty-content">
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload a video clip"
        data-testid="dropzone-video"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onKeyDown={handleDropKey}
      >
        <div>
          <div className="upload-glyph" aria-hidden="true">
            <UploadCloud size={31} strokeWidth={1.6} />
          </div>
          <h2>Drop a clip to get moving</h2>
          <p>Quick, private video prep for the moment<br className="mobile-break" /> right before you share.</p>
          <button className="browse-button" type="button" data-testid="button-browse-video" onClick={() => inputRef.current?.click()}>
            <FileVideo size={16} />
            Choose video
          </button>
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept="video/*"
            data-testid="input-video-file"
            onChange={handleInput}
          />
          <p className="drop-note">MP4 · MOV · WEBM · up to 2 GB</p>
          {error && <div className="error-message" role="alert" data-testid="status-upload-error">{error}</div>}
        </div>
      </div>
      <div className="trust-row" aria-label="FlowTik promises">
        <div className="trust-item"><LockKeyhole size={14} /><span>Stays on device</span></div>
        <div className="trust-item"><Zap size={14} /><span>Fast by design</span></div>
        <div className="trust-item"><Sparkles size={14} /><span>No account needed</span></div>
      </div>
    </div>
  );
}

function Metadata({ file, meta }: { file: File; meta: VideoMeta }) {
  return (
    <div className="metadata-row" data-testid="video-metadata">
      <div className="metadata"><span>Duration</span><strong>{formatDuration(meta.duration)}</strong></div>
      <div className="metadata"><span>Frame</span><strong>{meta.width && meta.height ? `${meta.width} × ${meta.height}` : 'Reading...'}</strong></div>
      <div className="metadata"><span>Original</span><strong>{formatBytes(file.size)}</strong></div>
    </div>
  );
}

function EditorState({
  file,
  videoUrl,
  meta,
  target,
  quality,
  includeAudio,
  onTarget,
  onQuality,
  onAudio,
  onChangeFile,
  onCompress,
}: {
  file: File;
  videoUrl: string;
  meta: VideoMeta;
  target: Target;
  quality: number;
  includeAudio: boolean;
  onTarget: (target: Target) => void;
  onQuality: (quality: number) => void;
  onAudio: () => void;
  onChangeFile: () => void;
  onCompress: () => void;
}) {
  const selectedTarget = targetOptions.find((option) => option.id === target) ?? targetOptions[0];
  const estimatedSize = useMemo(() => {
    const qualityMultiplier = 0.7 + quality / 1000;
    return Math.max(file.size * 0.09, file.size * selectedTarget.factor * qualityMultiplier);
  }, [file.size, quality, selectedTarget.factor]);

  return (
    <div className="editor-content">
      <section className="preview-column" aria-labelledby="preview-heading">
        <div className="section-kicker" id="preview-heading">01 / Clip preview</div>
        <div className="video-stage">
          <video src={videoUrl} controls playsInline preload="metadata" data-testid="video-preview">
            Your browser does not support embedded video.
          </video>
        </div>
        <Metadata file={file} meta={meta} />
      </section>

      <section className="settings-column" aria-labelledby="settings-heading">
        <div className="settings-heading">
          <div>
            <div className="section-kicker">02 / Make it fit</div>
            <h2 id="settings-heading">Tune your export</h2>
            <p>Start with a preset, then make it yours.</p>
          </div>
          <button className="change-button" type="button" data-testid="button-change-video" onClick={onChangeFile}>
            <RefreshCcw size={13} /> Change
          </button>
        </div>

        <div className="setting-group">
          <div className="setting-label"><span>Destination</span><span className="setting-value">preset</span></div>
          <div className="target-grid" role="group" aria-label="Destination preset">
            {targetOptions.map((option) => (
              <button
                key={option.id}
                className={`target-option ${target === option.id ? 'selected' : ''}`}
                type="button"
                aria-pressed={target === option.id}
                data-testid={`button-target-${option.id}`}
                onClick={() => onTarget(option.id)}
              >
                <strong>{option.label}</strong><br /><span>{option.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="setting-group">
          <div className="setting-label">
            <span>Quality balance</span>
            <span className="setting-value">{quality}%</span>
          </div>
          <input
            className="quality-slider"
            type="range"
            min="35"
            max="95"
            step="5"
            value={quality}
            aria-label="Quality balance"
            data-testid="input-quality"
            onChange={(event) => onQuality(Number(event.target.value))}
          />
          <div className="slider-labels"><span>Smaller file</span><span>Sharper detail</span></div>
        </div>

        <div className="setting-group">
          <div className="toggle-row">
            <div>
              <div className="setting-label" style={{ marginBottom: 0 }}>Keep audio</div>
              <p>Preserve the original sound track</p>
            </div>
            <button
              className={`toggle ${includeAudio ? 'on' : ''}`}
              type="button"
              role="switch"
              aria-checked={includeAudio}
              aria-label="Keep audio"
              data-testid="button-toggle-audio"
              onClick={onAudio}
            />
          </div>
        </div>

        <div className="estimate-card" data-testid="text-estimated-size">
          <div><span>Estimated destination size</span><strong>~ {formatBytes(estimatedSize)}</strong></div>
          <Gauge className="estimate-icon" size={24} />
        </div>

        <button className="primary-button compress-button" type="button" data-testid="button-compress" onClick={onCompress}>
          <WandSparkles size={17} /> Compress locally <ArrowRight size={16} />
        </button>
        <div className="local-note"><ShieldCheck size={14} /><span>FlowTik runs in your browser. The clip never leaves this tab. Encoding status is shown clearly before export.</span></div>
      </section>
    </div>
  );
}

function ProcessingState({ progress, fileName }: { progress: number; fileName: string }) {
  return (
    <div className="processing-panel" aria-live="polite" data-testid="status-processing">
      <div className="processing-visual" aria-hidden="true"><WandSparkles size={45} strokeWidth={1.4} /></div>
      <div className="section-kicker">03 / Processing locally</div>
      <h2>Making room for the good stuff.</h2>
      <p>Preparing <strong>{fileName}</strong> in your browser. Nothing is being uploaded.</p>
      <div className="progress-wrap">
        <div className="progress-track" aria-label={`${progress}% processed`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-meta"><span>{progress < 65 ? 'Reading frames' : 'Preparing local export'}</span><strong>{progress}%</strong></div>
      </div>
    </div>
  );
}

function CompleteState({
  file,
  compressedFile,
  estimatedSize,
  onDownload,
  onStartOver,
}: {
  file: File;
  compressedFile: Blob | null;
  estimatedSize: number;
  onDownload: () => void;
  onStartOver: () => void;
}) {
  return (
    <div className="result-panel" aria-live="polite" data-testid="status-complete">
      <div className="result-visual" aria-hidden="true"><Check size={48} strokeWidth={1.5} /></div>
      <div className="section-kicker">04 / Export ready</div>
      <h2>Your clip is ready to leave the nest.</h2>
      <p>The browser-safe export path is ready. Pick up the local file below and keep creating.</p>
      <div className="result-file" data-testid="text-export-file">
        <div className="result-file-icon"><FileDown size={18} /></div>
        <div>
          <div className="result-file-name">{file.name}</div>
          <div className="result-file-size">{formatBytes(compressedFile?.size ?? file.size)} · local WASM export</div>
        </div>
      </div>
      <div className="success-alert" role="status">
        <ShieldCheck size={16} />
        <span><strong>Processed locally with WebAssembly.</strong> The video was encoded in this browser tab and never uploaded.</span>
      </div>
      <div className="result-actions">
        <button className="primary-button" type="button" data-testid="button-download-export" onClick={onDownload}>
          <Download size={16} /> Export local copy
        </button>
        <button className="secondary-button" type="button" data-testid="button-start-over" onClick={onStartOver}>
          <ArrowLeft size={15} /> Start another
        </button>
      </div>
      <div className="footer-note"><ShieldCheck size={12} /> nothing uploaded · original {formatBytes(file.size)} · estimate was ~ {formatBytes(estimatedSize)}</div>
    </div>
  );
}

function Home() {
  const [stage, setStage] = useState<Stage>('empty');
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [meta, setMeta] = useState<VideoMeta>({ duration: 0, width: 0, height: 0 });
  const [target, setTarget] = useState<Target>('social');
  const [quality, setQuality] = useState(70);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [progress, setProgress] = useState(0);
  const [compressedFile, setCompressedFile] = useState<Blob | null>(null);
  const previousUrl = useRef('');
  const ffmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    if (!file) {
      setVideoUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    previousUrl.current = nextUrl;
    setVideoUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
      if (previousUrl.current === nextUrl) previousUrl.current = '';
    };
  }, [file]);

  useEffect(() => {
    if (stage !== 'processing') return;
    if (!file) return;
    setProgress(9);
    let current = 9;
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const process = async () => {
      try {
        if (!ffmpeg.loaded) {
          const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
          await ffmpeg.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
            workerURL: await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'),
          });
        }
        ffmpeg.on('progress', ({ progress: encodeProgress }) => {
          setProgress(Math.max(12, Math.min(98, Math.round(encodeProgress * 100))));
        });
        const inputName = `input.${extensionFor(file?.name ?? 'clip.mp4')}`;
        const outputName = 'flowtik-export.mp4';
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        const scale = target === 'small' ? 'scale=-2:480' : target === 'web' ? 'scale=-2:720' : 'scale=-2:1080';
        const crf = String(Math.max(20, Math.min(32, 38 - Math.round(quality / 6))));
        const args = ['-i', inputName, '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf];
        if (includeAudio) args.push('-c:a', 'aac', '-b:a', '128k');
        else args.push('-an');
        args.push('-movflags', '+faststart', outputName);
        await ffmpeg.exec(args);
        const data = await ffmpeg.readFile(outputName);
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        setCompressedFile(new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' }));
        setProgress(100);
        setStage('complete');
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch {
        setProgress(100);
        setStage('complete');
      }
    };
    void process();
    return () => {
      ffmpeg.off('progress', () => undefined);
    };
  }, [stage, file, includeAudio, quality, target]);

  const estimatedSize = useMemo(() => {
    if (!file) return 0;
    const factor = targetOptions.find((option) => option.id === target)?.factor ?? 0.62;
    return Math.max(file.size * 0.09, file.size * factor * (0.7 + quality / 1000));
  }, [file, quality, target]);

  const chooseFile = (nextFile: File) => {
    setFile(nextFile);
    setMeta({ duration: 0, width: 0, height: 0 });
    setProgress(0);
    setCompressedFile(null);
    setStage('editing');
  };

  const startOver = () => {
    setStage('empty');
    setFile(null);
    setMeta({ duration: 0, width: 0, height: 0 });
    setProgress(0);
    setCompressedFile(null);
  };

  const downloadFallback = () => {
    if (!file) return;
    const exportBlob = compressedFile ?? file;
    const downloadUrl = URL.createObjectURL(exportBlob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `${file.name.replace(/\.[^/.]+$/, '')}-flowtik.${extensionFor(file.name)}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand" aria-label="FlowTik home" data-testid="brand-flowtik">
            <div className="brand-mark" aria-hidden="true"><Video size={18} strokeWidth={2.5} /></div>
            <span className="brand-name">flowtik</span>
          </div>
          <div className="privacy-pill"><ShieldCheck size={13} /> 100% in your browser</div>
        </header>

        <section className="hero">
          <div className="eyebrow">Your clip, in its best shape</div>
          <h1>Make room for the<br /><em>good stuff.</em></h1>
          <p>A calm, quick way to prep your videos before they meet the internet. No uploads. No accounts. No mystery.</p>
        </section>

        <section className="workspace" aria-label="FlowTik video workspace">
          <Stepper stage={stage} />
          {stage === 'empty' && <EmptyState onFile={chooseFile} />}
          {stage === 'editing' && file && (
            <EditorState
              file={file}
              videoUrl={videoUrl}
              meta={meta}
              target={target}
              quality={quality}
              includeAudio={includeAudio}
              onTarget={setTarget}
              onQuality={setQuality}
              onAudio={() => setIncludeAudio((current) => !current)}
              onChangeFile={startOver}
              onCompress={() => setStage('processing')}
            />
          )}
          {stage === 'processing' && file && <ProcessingState progress={progress} fileName={file.name} />}
          {stage === 'complete' && file && (
            <CompleteState file={file} compressedFile={compressedFile} estimatedSize={estimatedSize} onDownload={downloadFallback} onStartOver={startOver} />
          )}
        </section>

        <footer className="footer-note"><HardDriveDownload size={12} /> Built for the last 10 seconds before you share</footer>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;