class PenaltyGame {
    constructor() {
        this.goals = 0;
        this.attempts = 0;
        this.isAnimating = false;
        
        this.ball = document.getElementById('ball');
        this.goalkeeper = document.getElementById('goalkeeper');
        this.result = document.getElementById('result');
        this.goalsDisplay = document.getElementById('goals');
        this.attemptsDisplay = document.getElementById('attempts');
        
        this.initializeGame();
    }
    
    initializeGame() {
        const zones = document.querySelectorAll('.zone');
        console.log(`Found ${zones.length} zones`); // Debug log
        
        zones.forEach((zone, index) => {
            const direction = zone.dataset.direction;
            console.log(`Zone ${index}: ${direction}`); // Debug log
            
            zone.addEventListener('click', (e) => {
                // Use currentTarget instead of target to get the zone div, not the span
                const clickedDirection = e.currentTarget.dataset.direction;
                console.log(`Clicked zone: ${clickedDirection}`); // Debug log
                this.shoot(clickedDirection);
            });
        });
        
            document.addEventListener('keydown', (e) => {
            if (this.isAnimating) return;
            
            switch(e.key.toLowerCase()) {
                case 'a':
                case 'arrowleft':
                    this.shoot('left');
                    break;
                case 's':
                case 'arrowdown':
                case 'arrowup':
                case ' ': // spacebar for middle
                    this.shoot('middle');
                    break;
                case 'd':
                case 'arrowright':
                    this.shoot('right');
                    break;
            }
        });
        
        this.updateDisplay();
    }
    
    shoot(direction) {
        if (this.isAnimating) return;
        
        console.log(`Shooting ${direction}`); // Debug log
        
        this.isAnimating = true;
        this.attempts++;
        
        // Clear previous result
        this.result.textContent = '';
        this.result.className = 'result';
        
        // Goalkeeper randomly chooses a position
        const keeperPositions = ['left', 'middle', 'right'];
        const keeperChoice = keeperPositions[Math.floor(Math.random() * keeperPositions.length)];
        
        console.log(`Keeper chose: ${keeperChoice}, Player shot: ${direction}`); // Debug log
        
        // Animate the shot
        this.animateShot(direction, keeperChoice);
    }
    
    animateShot(playerDirection, keeperDirection) {
        // Reset ball and goalkeeper positions
        this.ball.className = 'ball';
        this.goalkeeper.className = 'goalkeeper';
        
        console.log(`Animating shot: ${playerDirection} vs keeper: ${keeperDirection}`); // Debug log
        
        // Small delay to show the setup
        setTimeout(() => {
            // Move goalkeeper
            this.moveGoalkeeper(keeperDirection);
            
            // Shoot ball - make sure the class is added
            const ballClass = `shoot-${playerDirection}`;
            console.log(`Adding ball class: ${ballClass}`); // Debug log
            this.ball.classList.add(ballClass);
            
            // Determine result after initial animation
            setTimeout(() => {
                const isGoal = this.checkIfGoal(playerDirection, keeperDirection);
                console.log(`Result: ${isGoal ? 'GOAL' : 'SAVE'}`); // Debug log
                
                if (isGoal) {
                    // Ball goes in - continue with goal animation
                    this.handleGoal();
                } else {
                    // Ball is saved - show bounce back animation
                    this.handleSave(playerDirection);
                }
            }, 800); // Wait for initial shot animation
            
        }, 200);
    }
    
    checkIfGoal(playerDirection, keeperDirection) {
        // More realistic collision detection
        const isGoal = playerDirection !== keeperDirection;
        
        // Add some randomness for more realistic gameplay
        const randomFactor = Math.random();
        let finalResult = isGoal;
        
        if (randomFactor < 0.05 && isGoal) {
            // 5% chance goalkeeper makes an amazing save even when out of position
            finalResult = false;
        } else if (randomFactor < 0.03 && !isGoal) {
            // 3% chance ball slips through even when goalkeeper is in position
            finalResult = true;
        }
        
        return finalResult;
    }
    
    handleGoal() {
        this.goals++;
        this.showResult('GOAL! ⚽', 'goal');
        this.ball.classList.add('goal-animation');
        this.celebrateGoal();
        this.updateDisplay();
        
        // Reset after showing result
        setTimeout(() => {
            this.resetPositions();
        }, 2000);
    }
    
    handleSave(playerDirection) {
        console.log(`Handling save for direction: ${playerDirection}`); // Debug log
        
        // Remove shooting animation and add bounce animation
        this.ball.classList.remove(`shoot-${playerDirection}`);
        
        // Small delay to show the save moment
        setTimeout(() => {
            this.ball.classList.add(`bounce-${playerDirection}`);
            console.log(`Added bounce class: bounce-${playerDirection}`); // Debug log
        }, 100);
        
        this.showResult('SAVED! 🥅', 'save');
        this.celebrateSave();
        this.updateDisplay();
        
        // Reset after bounce animation completes (ball goes off screen)
        setTimeout(() => {
            this.resetPositions();
        }, 1500); // Shorter timeout since ball goes off screen
    }
    
    moveGoalkeeper(direction) {
        // Show the diving/jumping motion
        switch(direction) {
            case 'left':
                this.goalkeeper.classList.add('dive-left');
                break;
            case 'right':
                this.goalkeeper.classList.add('dive-right');
                break;
            case 'middle':
                this.goalkeeper.classList.add('jump-middle');
                break;
        }
    }
    
    // Remove the old determineResult method since we split it into separate methods
    
    showResult(message, type) {
        this.result.textContent = message;
        this.result.classList.add(type);
    }
    
    celebrateGoal() {
        // Add some visual celebration effects
        this.createConfetti();
        
        // Play a celebration sound effect (if you want to add audio)
        // this.playSound('goal');
    }
    
    celebrateSave() {
        // Goalkeeper celebration animation
        setTimeout(() => {
            this.goalkeeper.style.transform += ' translateY(-10px)';
        }, 100);
        
        setTimeout(() => {
            this.goalkeeper.style.transform = this.goalkeeper.style.transform.replace(' translateY(-10px)', '');
        }, 300);
    }
    
    createConfetti() {
        // Simple confetti effect
        for (let i = 0; i < 20; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'absolute';
            confetti.style.width = '10px';
            confetti.style.height = '10px';
            confetti.style.backgroundColor = ['#FFD700', '#FF6B35', '#4ECDC4', '#45B7D1'][Math.floor(Math.random() * 4)];
            confetti.style.left = Math.random() * window.innerWidth + 'px';
            confetti.style.top = '0px';
            confetti.style.borderRadius = '50%';
            confetti.style.pointerEvents = 'none';
            confetti.style.zIndex = '1000';
            
            document.body.appendChild(confetti);
            
            // Animate confetti falling
            const animation = confetti.animate([
                { transform: 'translateY(0px) rotate(0deg)', opacity: 1 },
                { transform: `translateY(${window.innerHeight}px) rotate(360deg)`, opacity: 0 }
            ], {
                duration: 3000,
                easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            });
            
            animation.onfinish = () => confetti.remove();
        }
    }
    
    resetPositions() {
        // Reset ball
        this.ball.className = 'ball';
        
        // Reset goalkeeper - remove all animation classes
        this.goalkeeper.className = 'goalkeeper';
        this.goalkeeper.style.transform = '';
        
        // Clear result
        this.result.textContent = '';
        this.result.className = 'result';
        
        this.isAnimating = false;
    }
    
    updateDisplay() {
        this.goalsDisplay.textContent = this.goals;
        this.attemptsDisplay.textContent = this.attempts;
    }
    
    // Method to reset the game
    resetGame() {
        this.goals = 0;
        this.attempts = 0;
        this.updateDisplay();
        this.resetPositions();
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new PenaltyGame();
    
    // Add reset functionality (optional)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'r' || e.key === 'R') {
            game.resetGame();
        }
    });
    
    // Add some helpful tips
    console.log('🎮 Penalty Shootout Controls:');
    console.log('• Click LEFT, MIDDLE, or RIGHT zones to shoot');
    console.log('• Use A, S, D keys or Arrow keys');
    console.log('• Press R to reset the game');
    console.log('• Try to beat the goalkeeper and score goals!');
});

// Add some dynamic background effects
function createFloatingElements() {
    const field = document.querySelector('.field');
    
    setInterval(() => {
        if (Math.random() < 0.1) { // 10% chance every interval
            const element = document.createElement('div');
            element.style.position = 'absolute';
            element.style.width = '3px';
            element.style.height = '3px';
            element.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
            element.style.borderRadius = '50%';
            element.style.left = Math.random() * 100 + '%';
            element.style.top = '100%';
            element.style.pointerEvents = 'none';
            
            field.appendChild(element);
            
            // Animate upward
            const animation = element.animate([
                { transform: 'translateY(0px)', opacity: 0.3 },
                { transform: 'translateY(-200px)', opacity: 0 }
            ], {
                duration: 4000,
                easing: 'ease-out'
            });
            
            animation.onfinish = () => element.remove();
        }
    }, 500);
}

// Start background effects
document.addEventListener('DOMContentLoaded', createFloatingElements);