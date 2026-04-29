// src/components/Canvas.tsx
import React, { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { Point, Tool } from '../types';

interface CanvasProps {
  doc: Y.Doc;
  undoManager: Y.UndoManager;
}

export default function Canvas({ doc, undoManager }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completingTextRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  const isInputReadyRef = useRef(false);
  
  const [currentTool, setCurrentTool] = useState<Tool>('freehand');
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastMousePos, setLastMousePos] = useState<Point | null>(null);
  const [editingText, setEditingText] = useState<{ id: string, x: number, y: number, value: string } | null>(null);

  const yStrokes = doc.getMap<Y.Map<any>>('strokes');

  // Calculates the RAW, unscaled boundaries of the shape based on its original points
  const getBoundingBox = (type: Tool, points: Point[], textValue?: string) => {
    if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    
    if (type === 'circle' && points.length >= 2) {
      const [p1, p2] = points;
      const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      return {
        minX: p1.x - radius, minY: p1.y - radius,
        maxX: p1.x + radius, maxY: p1.y + radius
      };
    }
    
    if (type === 'text' && textValue) {
      const p = points[0];
      const width = textValue.length * 12 + 20; 
      return { minX: p.x, minY: p.y, maxX: p.x + width, maxY: p.y + 24 };
    }

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
      minX: Math.min(...xs), minY: Math.min(...ys),
      maxX: Math.max(...xs), maxY: Math.max(...ys)
    };
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'top';

    yStrokes.forEach((yStroke, id) => {
      const type = (yStroke.get('type') as Tool) || 'freehand';
      const color = yStroke.get('color') as string;
      const textValue = yStroke.get('textValue') as string;
      
      const offsetX = (yStroke.get('offsetX') as number) || 0;
      const offsetY = (yStroke.get('offsetY') as number) || 0;
      const scaleX = (yStroke.get('scaleX') as number) || 1;
      const scaleY = (yStroke.get('scaleY') as number) || 1;
      
      const yPoints = yStroke.get('points') as Y.Array<Point>;
      if (!yPoints) return;
      const points = yPoints.toArray();
      if (points.length === 0) return;

      // --- 1. Draw the actual shape (Scaled) ---
      ctx.save(); 
      ctx.translate(offsetX, offsetY); 
      ctx.scale(scaleX, scaleY);

      // Keep stroke thickness visually consistent despite scaling
      const maxScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
      ctx.lineWidth = maxScale === 0 ? 4 : 4 / maxScale;
      
      ctx.strokeStyle = color || '#000000';
      ctx.fillStyle = color || '#000000';
      ctx.beginPath();

      if (type === 'freehand') {
        let isFirst = true;
        points.forEach((p) => {
          if (p.isBreak) { isFirst = true; } 
          else {
            if (isFirst) { ctx.moveTo(p.x, p.y); isFirst = false; } 
            else { ctx.lineTo(p.x, p.y); }
          }
        });
        ctx.stroke();
      } 
      else if (type === 'rectangle' && points.length >= 2) {
        const [p1, p2] = points;
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      } 
      else if (type === 'circle' && points.length >= 2) {
        const [p1, p2] = points;
        const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        ctx.arc(p1.x, p1.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } 
      else if (type === 'text') {
        if (!editingText || editingText.id !== id) {
          ctx.font = '20px sans-serif';
          ctx.fillText(textValue, points[0].x, points[0].y);
        }
      }
      ctx.restore(); // Exit transform so the UI overlays don't get warped

      // --- 2. Draw Selection Box and Resize Handle (Unscaled strokes) ---
      if (id === activeId && currentTool === 'select') {
        const { minX, minY, maxX, maxY } = getBoundingBox(type, points, textValue);
        
        // Calculate where the borders are relative to the canvas
        const scaledMinX = minX * scaleX + offsetX;
        const scaledMinY = minY * scaleY + offsetY;
        const scaledMaxX = maxX * scaleX + offsetX;
        const scaledMaxY = maxY * scaleY + offsetY;
        
        const pad = 5;
        
        // Dashed Box
        ctx.save();
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]); 
        ctx.strokeRect(
          scaledMinX - pad, 
          scaledMinY - pad, 
          (scaledMaxX - scaledMinX) + pad * 2, 
          (scaledMaxY - scaledMinY) + pad * 2
        );
        
        // Solid Bottom-Right Resize Handle
        ctx.setLineDash([]);
        ctx.fillStyle = '#007bff';
        ctx.fillRect(scaledMaxX + pad - 6, scaledMaxY + pad - 6, 12, 12);
        ctx.restore();
      }
    });
  };

  useEffect(() => {
    yStrokes.observeDeep(() => draw());
    draw(); 
  }, [yStrokes, activeId, currentTool, editingText]);

  const getPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const isPointInShape = (point: Point, stroke: Y.Map<any>) => {
    const points = (stroke.get('points') as Y.Array<Point>).toArray();
    if (points.length === 0) return false;

    const offsetX = (stroke.get('offsetX') as number) || 0;
    const offsetY = (stroke.get('offsetY') as number) || 0;
    const scaleX = (stroke.get('scaleX') as number) || 1;
    const scaleY = (stroke.get('scaleY') as number) || 1;
    
    // Reverse the scale to check the mouse against the original math
    const px = scaleX === 0 ? 0 : (point.x - offsetX) / scaleX;
    const py = scaleY === 0 ? 0 : (point.y - offsetY) / scaleY;

    const { minX, minY, maxX, maxY } = getBoundingBox(stroke.get('type') as Tool, points, stroke.get('textValue') as string);
    const padding = 10;

    return px >= minX - padding && px <= maxX + padding && py >= minY - padding && py <= maxY + padding;
  };

  const handleErase = (point: Point) => {
    doc.transact(() => {
      const keys = Array.from(yStrokes.keys());
      for (const id of keys) {
        const stroke = yStrokes.get(id);
        if (!stroke) continue;
        
        const type = stroke.get('type') as Tool;
        if (type !== 'freehand') {
          if (isPointInShape(point, stroke)) yStrokes.delete(id);
        } else {
          const yPoints = stroke.get('points') as Y.Array<Point>;
          const points = yPoints.toArray();
          const offsetX = (stroke.get('offsetX') as number) || 0;
          const offsetY = (stroke.get('offsetY') as number) || 0;
          const scaleX = (stroke.get('scaleX') as number) || 1;
          const scaleY = (stroke.get('scaleY') as number) || 1;
          
          for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            if (p.isBreak) continue;
            
            // Apply scale to find where the ink actually is on screen
            const px = p.x * scaleX + offsetX;
            const py = p.y * scaleY + offsetY;
            
            if (Math.hypot(px - point.x, py - point.y) < 20) {
              yPoints.delete(i, 1);
              yPoints.insert(i, [{ x: p.x, y: p.y, isBreak: true }]);
            }
          }
          
          // Clean up if stroke is mostly erased or empty
          const remainingPoints = yPoints.toArray();
          const nonBreakPoints = remainingPoints.filter(p => !p.isBreak);
          
          // Delete stroke if it has fewer than 2 drawable points
          if (nonBreakPoints.length < 2) {
            yStrokes.delete(id);
          }
        }
      }
    });
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('🖱️ startDrawing called, currentTool:', currentTool, 'editingText:', editingText);
    if (editingText) { 
      console.log('📝 Completing current text before processing click');
      // Force completion by marking as ready
      isInputReadyRef.current = true;
      handleTextComplete();
      // Don't process the new click yet - let the state clear first
      return;
    }
    const point = getPoint(e);
    if (!point) return;

    if (currentTool === 'eraser') {
      setIsDrawing(true);
      handleErase(point);
      return;
    }

    if (currentTool === 'select') {
      // 1. First, check if we clicked the Resize Handle of the ALREADY active shape
      if (activeId) {
        const stroke = yStrokes.get(activeId);
        if (stroke) {
          const points = (stroke.get('points') as Y.Array<Point>).toArray();
          const scaleX = (stroke.get('scaleX') as number) || 1;
          const scaleY = (stroke.get('scaleY') as number) || 1;
          const offsetX = (stroke.get('offsetX') as number) || 0;
          const offsetY = (stroke.get('offsetY') as number) || 0;
          const { maxX, maxY } = getBoundingBox(stroke.get('type') as Tool, points, stroke.get('textValue') as string);
          
          const scaledMaxX = maxX * scaleX + offsetX;
          const scaledMaxY = maxY * scaleY + offsetY;

          // If mouse is within ~15px of the bottom-right corner handle
          if (Math.abs(point.x - scaledMaxX) < 15 && Math.abs(point.y - scaledMaxY) < 15) {
            setIsResizing(true);
            setIsDrawing(true);
            setLastMousePos(point);
            return;
          }
        }
      }

      // 2. Otherwise, check if we are selecting a shape to move
      const keys = Array.from(yStrokes.keys());
      for (let i = keys.length - 1; i >= 0; i--) {
        const id = keys[i];
        const stroke = yStrokes.get(id);
        if (stroke && isPointInShape(point, stroke)) {
          setActiveId(id);
          setIsDrawing(true);
          setLastMousePos(point);
          return;
        }
      }
      setActiveId(null); 
      return;
    }

    // Text & Creation logic
    if (currentTool === 'text') {
      console.log('✏️ Text tool clicked at:', point);
      // Check if we clicked on an existing text element to edit it
      const keys = Array.from(yStrokes.keys());
      for (let i = keys.length - 1; i >= 0; i--) {
        const id = keys[i];
        const stroke = yStrokes.get(id);
        if (stroke && stroke.get('type') === 'text' && isPointInShape(point, stroke)) {
          console.log('📄 Clicked on existing text, editing it');
          const points = (stroke.get('points') as Y.Array<Point>).toArray();
          const offsetX = (stroke.get('offsetX') as number) || 0;
          const offsetY = (stroke.get('offsetY') as number) || 0;
          const scaleX = (stroke.get('scaleX') as number) || 1;
          const scaleY = (stroke.get('scaleY') as number) || 1;
          
          const textX = points[0].x * scaleX + offsetX;
          const textY = points[0].y * scaleY + offsetY;
          const currentValue = stroke.get('textValue') as string || '';
          
          setEditingText({ id, x: textX, y: textY, value: currentValue });
          return;
        }
      }
      
      // Create new text element
      console.log('➕ Creating new text element at:', point);
      const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
      doc.transact(() => {
        const yStroke = new Y.Map();
        const yPoints = new Y.Array<Point>();
        yPoints.push([point]);
        yStroke.set('type', 'text');
        yStroke.set('color', '#000000');
        yStroke.set('offsetX', 0); yStroke.set('offsetY', 0);
        yStroke.set('scaleX', 1); yStroke.set('scaleY', 1);
        yStroke.set('points', yPoints);
        yStroke.set('textValue', '');
        yStrokes.set(id, yStroke);
      });
      console.log('📝 Setting editingText state:', { id, x: point.x, y: point.y });
      setEditingText({ id, x: point.x, y: point.y, value: '' });
      return;
    }

    setActiveId(null);
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    setActiveId(id);
    setIsDrawing(true);

    doc.transact(() => {
      const yStroke = new Y.Map();
      const yPoints = new Y.Array<Point>();
      yPoints.push([point]);
      yStroke.set('type', currentTool);
      yStroke.set('color', '#000000');
      yStroke.set('offsetX', 0); yStroke.set('offsetY', 0);
      yStroke.set('scaleX', 1); yStroke.set('scaleY', 1);
      yStroke.set('points', yPoints);
      yStrokes.set(id, yStroke);
    });
  };

  const drawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || currentTool === 'text') return;
    const point = getPoint(e);
    if (!point) return;

    if (currentTool === 'eraser') { handleErase(point); return; }

    if (!activeId) return;
    const yStroke = yStrokes.get(activeId);
    if (!yStroke) return;

    // --- NEW: Resizing Logic ---
    if (isResizing && lastMousePos) {
      const points = (yStroke.get('points') as Y.Array<Point>).toArray();
      const { minX, minY, maxX, maxY } = getBoundingBox(yStroke.get('type') as Tool, points, yStroke.get('textValue') as string);
      
      const unscaledW = maxX - minX;
      const unscaledH = maxY - minY;
      
      if (unscaledW === 0 || unscaledH === 0) return; // Prevent infinity issues on flat lines

      doc.transact(() => {
        const curScaleX = (yStroke.get('scaleX') as number) || 1;
        const curScaleY = (yStroke.get('scaleY') as number) || 1;
        const curOffsetX = (yStroke.get('offsetX') as number) || 0;
        const curOffsetY = (yStroke.get('offsetY') as number) || 0;

        // Calculate where the top-left corner currently sits on the screen
        const fixedTLX = minX * curScaleX + curOffsetX;
        const fixedTLY = minY * curScaleY + curOffsetY;

        // Stretch the multiplier based on how far the mouse is from the top-left
        const newScaleX = (point.x - fixedTLX) / unscaledW;
        const newScaleY = (point.y - fixedTLY) / unscaledH;

        yStroke.set('scaleX', newScaleX);
        yStroke.set('scaleY', newScaleY);
        
        // Counter-adjust the offset so the top-left corner stays perfectly pinned
        yStroke.set('offsetX', fixedTLX - minX * newScaleX);
        yStroke.set('offsetY', fixedTLY - minY * newScaleY);
      });
      return;
    }

    // --- Moving Logic ---
    if (currentTool === 'select' && lastMousePos) {
      const dx = point.x - lastMousePos.x;
      const dy = point.y - lastMousePos.y;
      doc.transact(() => {
        const curX = (yStroke.get('offsetX') as number) || 0;
        const curY = (yStroke.get('offsetY') as number) || 0;
        yStroke.set('offsetX', curX + dx);
        yStroke.set('offsetY', curY + dy);
      });
      setLastMousePos(point);
    } 
    else {
      // --- Standard Drawing Logic ---
      const yPoints = yStroke.get('points') as Y.Array<Point>;
      doc.transact(() => {
        if (currentTool === 'freehand') {
          yPoints.push([point]);
        } else {
          if (yPoints.length === 1) yPoints.push([point]);
          else if (yPoints.length === 2) {
            yPoints.delete(1, 1);
            yPoints.insert(1, [point]);
          }
        }
      });
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    setIsResizing(false);
    setLastMousePos(null);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingText) return;
    const newValue = e.target.value;
    console.log('⌨️ Text changed:', newValue);
    // Mark input as ready once user starts typing
    if (!isInputReadyRef.current) {
      console.log('✅ Input marked as ready (user is typing)');
      isInputReadyRef.current = true;
    }
    setEditingText({ ...editingText, value: newValue });
    const stroke = yStrokes.get(editingText.id);
    if (stroke) stroke.set('textValue', newValue);
  };

  const handleTextComplete = () => {
    console.log('✅ handleTextComplete called, editingText:', editingText, 'completing:', completingTextRef.current, 'inputReady:', isInputReadyRef.current);
    if (!editingText || completingTextRef.current) return;
    
    // Only proceed if input is ready OR if we're force-completing (e.g., switching tools)
    if (!isInputReadyRef.current) {
      console.log('⚠️ Input not ready yet, skipping blur');
      return;
    }
    
    completingTextRef.current = true;
    const stroke = yStrokes.get(editingText.id);
    if (stroke && !editingText.value.trim()) {
      console.log('🗑️ Deleting empty text box (no text entered)');
      yStrokes.delete(editingText.id);
    } else {
      console.log('💾 Saving text:', editingText.value);
    }
    setEditingText(null);
    isInputReadyRef.current = false;
    setTimeout(() => { completingTextRef.current = false; }, 0);
  };
  
  // Effect to focus and mark input as ready when it mounts
  useEffect(() => {
    if (editingText && textInputRef.current) {
      console.log('🎯 Focusing text input');
      textInputRef.current.focus();
      // Mark as ready immediately after focus
      requestAnimationFrame(() => {
        isInputReadyRef.current = true;
        console.log('✅ Input is ready for blur events');
      });
    }
  }, [editingText]);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', alignItems: 'flex-start' }}>
      <div style={{ 
        display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8f9fa', 
        padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minWidth: '80px'
      }}>
        <strong style={{ fontSize: '14px', marginBottom: '5px' }}>Tools</strong>
        {(['select', 'freehand', 'rectangle', 'circle', 'text', 'eraser'] as Tool[]).map((tool) => (
          <button
            key={tool}
            onClick={() => {
              setCurrentTool(tool);
              if (editingText) handleTextComplete(); 
            }}
            style={{
              padding: '10px', backgroundColor: currentTool === tool ? '#007bff' : '#fff',
              color: currentTool === tool ? '#fff' : '#333',
              border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', textTransform: 'capitalize'
            }}
          >
            {tool}
          </button>
        ))}

        <hr style={{ width: '100%', borderColor: '#ddd' }} />
        <strong style={{ fontSize: '14px' }}>Actions</strong>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button onClick={() => undoManager.undo()} style={{ flex: 1, padding: '8px', cursor: 'pointer' }}>Undo</button>
          <button onClick={() => undoManager.redo()} style={{ flex: 1, padding: '8px', cursor: 'pointer' }}>Redo</button>
        </div>
        <button 
          onClick={() => { yStrokes.clear(); setActiveId(null); setEditingText(null); }}
          style={{ padding: '8px', cursor: 'pointer', border: '1px solid #ff4444', color: '#ff4444', background: '#fff', borderRadius: '4px', marginTop: '10px' }}
        >
          Clear
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          style={{ 
            border: '2px solid #ddd', borderRadius: '8px', 
            cursor: currentTool === 'text' ? 'text' : currentTool === 'select' ? 'default' : currentTool === 'eraser' ? 'cell' : 'crosshair', 
            backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', display: 'block'
          }}
          onMouseDown={startDrawing}
          onMouseMove={drawMove}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
        />

        {editingText && (
          <input
            autoFocus
            value={editingText.value}
            onChange={handleTextChange}
            onBlur={handleTextComplete}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTextComplete(); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: editingText.x + 2, top: editingText.y + 2, 
              font: '20px sans-serif', background: 'transparent', border: '1px dashed #007bff', 
              outline: 'none', padding: 0, margin: 0, color: '#000', 
              minWidth: '50px', width: `${Math.max(50, editingText.value.length * 12 + 20)}px`
            }}
          />
        )}
      </div>
    </div>
  );
}