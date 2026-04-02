export type Point = {
  x: number;
  y: number;
  isBreak?: boolean;
};

export type Tool = 'select' | 'freehand' | 'rectangle' | 'circle' | 'text' | 'eraser';