# Neural Network Training Game

An educational Love2D game that teaches neural network concepts through interactive visualization and hands-on training.

## Overview

This game provides an interactive way to understand how neural networks work, specifically focusing on:
- Forward propagation
- Backpropagation
- Gradient descent
- Activation functions (ReLU and Softmax)
- Matrix operations
- Weight updates
- Loss calculation

The game uses the MNIST digit recognition task as its core example, allowing players to draw digits and watch the network learn to recognize them.

## Features

### Core Concepts Taught
- **Neuron Basics**: Visual representation of how neurons process inputs with weights and biases
- **Layer Architecture**: Interactive visualization of input, hidden, and output layers
- **Activation Functions**: 
  - ReLU (Rectified Linear Unit) for hidden layers
  - Softmax for output probability distribution
- **Loss Measurement**: Cross-entropy loss visualization
- **Backpropagation**: Step-by-step gradient flow visualization
- **Gradient Descent**: Real-time weight updates with adjustable learning rate

### Interactive Elements
- **Drawing Canvas**: Draw digits (0-9) and see real-time predictions
- **Network Visualization**: Watch signals flow through the network
- **Weight Visualization**: See connection strengths between neurons
- **Training Controls**: Start/stop training, step through samples
- **Hyperparameter Tuning**: Adjust learning rate in real-time
- **Metrics Dashboard**: Track loss and accuracy over time

## Technical Implementation

### Pure Lua/Love2D Implementation
The entire neural network is implemented from scratch in pure Lua:
- No external machine learning libraries
- Raw matrix operations
- Mathematical functions implemented directly

### Architecture
- **Input Layer**: 64 neurons (8x8 pixel grid)
- **Hidden Layer**: 16 neurons with ReLU activation
- **Output Layer**: 10 neurons (digits 0-9) with Softmax activation

### Files Structure
```
ai_project/
├── main.lua           # Main game loop and UI
├── neuralnetwork.lua  # Neural network implementation
├── matrix.lua         # Matrix operations library
├── mnist.lua          # MNIST data handling
├── conf.lua           # Love2D configuration
└── project-manager/
    └── execution-plan.md  # Development plan
```

## Installation & Running

### Prerequisites
1. Install Love2D (version 11.4 or later):
   - macOS: `brew install love`
   - Or download from: https://love2d.org/

### Running the Game
```bash
cd /Users/raymondgonzalez/ai_project
love .
```

Or drag the project folder onto the Love2D application.

## How to Play

### Main Menu
- Press **SPACE** to start the game
- Press **ESC** to return to menu or quit

### Training Mode

#### Drawing
- Click and drag on the canvas to draw digits
- The network will predict what digit you drew in real-time

#### Controls
- **Train Button**: Start/stop automatic training
- **Step Button**: Train on one sample
- **Reset Button**: Reset the neural network
- **Clear Button**: Clear the drawing canvas

#### Keyboard Shortcuts
- **Space**: Toggle training
- **C**: Clear canvas
- **R**: Reset network
- **T**: Single training step
- **0-9**: Load preset digit patterns
- **ESC**: Return to menu

#### Adjustable Parameters
- **Learning Rate Slider**: Adjust how quickly the network learns (0.0001 - 0.1)
- **Visualization Toggles**: Show/hide weights and gradients

## Educational Value

### Visual Learning
- See how data flows through the network
- Watch weights change during training
- Observe activation patterns in neurons
- Track loss reduction over epochs

### Hands-On Experience
- Draw your own training data
- Experiment with hyperparameters
- See immediate effects of changes
- Understand why networks fail or succeed

### Mathematical Understanding
The game visualizes key equations:
- Forward pass: `z = Wx + b`, `a = activation(z)`
- Loss: `L = -Σ(y_true * log(y_pred))`
- Backprop: `∂L/∂W = ∂L/∂z * ∂z/∂W`
- Weight update: `W_new = W_old - α * ∂L/∂W`

## Key Concepts Explained

### ReLU Activation
```lua
f(x) = max(0, x)
```
Introduces non-linearity while being computationally efficient.

### Softmax Function
```lua
softmax(z_i) = exp(z_i) / Σ(exp(z_j))
```
Converts raw outputs to probability distribution.

### Cross-Entropy Loss
```lua
L = -Σ(y_true * log(y_pred))
```
Measures difference between predicted and true distributions.

### Gradient Descent
```lua
W = W - learning_rate * gradient
```
Iteratively adjusts weights to minimize loss.

## Development Notes

### Performance
- Optimized for 60 FPS gameplay
- Efficient matrix operations
- Batch processing available

### Extensibility
The modular design allows for:
- Adding more layers
- Implementing different activation functions
- Creating new training datasets
- Adding more visualization modes

## Future Enhancements

Potential additions:
- Convolutional layer visualization
- Batch normalization
- Dropout demonstration
- Different optimization algorithms (Adam, RMSprop)
- Save/load trained models
- More complex datasets
- Mini-batch training
- Regularization techniques

## Credits

Based on concepts from the MNIST digit recognition task and inspired by neural network fundamentals. Pure Lua implementation for educational purposes.

## License

Educational project - free to use and modify for learning purposes.

## Troubleshooting

### Common Issues

1. **Game won't start**: Ensure Love2D is properly installed and you're in the correct directory
2. **Low FPS**: Reduce training speed or disable weight visualization
3. **Network not learning**: Try adjusting the learning rate or resetting the network
4. **Canvas not responding**: Make sure you're clicking within the canvas boundaries

### Debug Mode
To enable console output for debugging, edit `conf.lua`:
```lua
t.console = true  -- Change from false to true
```

## Learning Resources

To deepen your understanding:
- Experiment with different network architectures
- Try training on your own drawn digits
- Observe how different learning rates affect convergence
- Watch the gradients during backpropagation
- Compare predictions before and after training

This game demonstrates that neural networks are not black boxes but mathematical models that can be understood through visualization and interaction.
# journey-board
