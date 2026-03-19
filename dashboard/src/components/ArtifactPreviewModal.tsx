import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import './ArtifactPreviewModal.css';

interface ArtifactPreviewModalProps {
  artifactId: string;
  filename: string;
  artifactType: string;
  onClose: () => void;
}

interface ArtifactContent {
  success: boolean;
  artifact_id: string;
  filename: string;
  artifact_type: string;
  content: string;
  encoding: string;
  size_bytes: number;
}

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'monospace',
});

// Mermaid component for code blocks
const MermaidDiagram = ({ code }: { code: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        setSvg(svg);
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        setSvg(`<pre>Failed to render diagram:\n${code}</pre>`);
      }
    };
    renderDiagram();
  }, [code]);

  return <div ref={ref} className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
};

const ArtifactPreviewModal = ({ artifactId, filename, artifactType, onClose }: ArtifactPreviewModalProps) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<string>('utf-8');

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        const response = await fetch(`http://localhost:4301/api/artifacts/${artifactId}/content`);

        if (!response.ok) {
          throw new Error(`Failed to load artifact: ${response.statusText}`);
        }

        const data: ArtifactContent = await response.json();

        if (data.success) {
          setContent(data.content);
          setEncoding(data.encoding);
        } else {
          setError('Failed to load artifact content');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [artifactId]);

  const renderContent = () => {
    if (loading) {
      return <div className="loading">Loading artifact...</div>;
    }

    if (error) {
      return <div className="error">Error: {error}</div>;
    }

    if (encoding === 'base64') {
      return <div className="binary-file">Binary file - preview not available</div>;
    }

    // Render based on file type
    if (filename.endsWith('.md') || filename.endsWith('.markdown')) {
      return (
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                const codeString = String(children).replace(/\n$/, '');

                // Render Mermaid diagrams
                if (language === 'mermaid' && !inline) {
                  return <MermaidDiagram code={codeString} />;
                }

                // Regular code block
                if (!inline) {
                  return (
                    <pre className={className} {...props}>
                      <code className={className}>{children}</code>
                    </pre>
                  );
                }

                // Inline code
                return <code className={className} {...props}>{children}</code>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      );
    }

    if (filename.endsWith('.json')) {
      try {
        const formatted = JSON.stringify(JSON.parse(content), null, 2);
        return <pre className="code-content">{formatted}</pre>;
      } catch {
        return <pre className="code-content">{content}</pre>;
      }
    }

    if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
      return <pre className="code-content">{content}</pre>;
    }

    // Plain text fallback
    return <pre className="plain-text-content">{content}</pre>;
  };

  return (
    <div className="artifact-preview-modal-overlay" onClick={onClose}>
      <div className="artifact-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-info">
            <h2>{filename}</h2>
            <span className="artifact-type-badge">{artifactType}</span>
          </div>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default ArtifactPreviewModal;
