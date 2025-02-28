const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});
app.use(express.static('public')); // Serve static files from 'public' directory

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected');
    
    // Join a specific session room
    socket.on('join-session', (sessionName) => {
        console.log(`Client joined session: ${sessionName}`);
        socket.join(sessionName);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Database setup
const db = new sqlite3.Database(path.join(__dirname, 'db/questions.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to database');
        
        // First, create sessions table if it doesn't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating sessions table:', err);
            } else {
                console.log('Sessions table ready');
                
                // Check if questions table exists, check if session_id column exists
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'", (err, row) => {
                    if (err) {
                        console.error('Error checking for questions table:', err);
                    } else if (!row) {
                        // Questions table doesn't exist, create it with session_id
                        db.run(`
                            CREATE TABLE questions (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                content TEXT NOT NULL,
                                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'selected', 'on_air', 'done')),
                                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                view_style TEXT DEFAULT 'view1',
                                session_id INTEGER,
                                FOREIGN KEY (session_id) REFERENCES sessions(id)
                            )
                        `, (err) => {
                            if (err) {
                                console.error('Error creating questions table:', err);
                            } else {
                                console.log('Questions table created with session_id');
                            }
                        });
                    } else {
                        // Questions table exists, check if session_id column exists
                        db.all("PRAGMA table_info(questions)", (err, rows) => {
                            if (err) {
                                console.error('Error getting questions table info:', err);
                            } else {
                                // Check if session_id column exists in the results
                                const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
                                
                                if (!hasSessionId) {
                                    // Add session_id column to questions table
                                    db.run(`
                                        ALTER TABLE questions 
                                        ADD COLUMN session_id INTEGER 
                                        REFERENCES sessions(id)
                                    `, (err) => {
                                        if (err) {
                                            console.error('Error adding session_id to questions table:', err);
                                        } else {
                                            console.log('Added session_id column to questions table');
                                        }
                                    });
                                } else {
                                    console.log('Questions table already has session_id column');
                                }
                            }
                        });
                    }
                });
            }
        });
    }
});

// Get all questions
app.get('/api/questions', (req, res) => {
    const sessionName = req.query.session;
    console.log('Getting questions for session:', sessionName);
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row) {
            // Sessions table doesn't exist, create it
            db.run(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating sessions table:', err);
                    return res.status(500).json({ error: 'Failed to create sessions table: ' + err.message });
                }
                
                // Now check if questions table has session_id column
                checkQuestionsTableAndGetQuestions(sessionName, res);
            });
        } else {
            // Sessions table exists, proceed with getting questions
            checkQuestionsTableAndGetQuestions(sessionName, res);
        }
    });
});

// Helper function to check questions table and get questions
function checkQuestionsTableAndGetQuestions(sessionName, res) {
    // Check if questions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'", (err, row) => {
        if (err) {
            console.error('Error checking for questions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row) {
            // Questions table doesn't exist, create it
            db.run(`
                CREATE TABLE IF NOT EXISTS questions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    status TEXT DEFAULT 'new' CHECK(status IN ('new', 'selected', 'on_air', 'done')),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    view_style TEXT DEFAULT 'view1',
                    session_id INTEGER REFERENCES sessions(id)
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating questions table:', err);
                    return res.status(500).json({ error: 'Failed to create questions table: ' + err.message });
                }
                
                // Return empty array since table was just created
                return res.json([]);
            });
            return;
        }
        
        // Check if questions table has session_id column
        db.all("PRAGMA table_info(questions)", (err, rows) => {
            if (err) {
                console.error('Error getting questions table info:', err);
                return res.status(500).json({ error: 'Database error: ' + err.message });
            }
            
            // Check if session_id column exists
            const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
            
            if (!hasSessionId) {
                // Add session_id column to questions table
                db.run(`
                    ALTER TABLE questions 
                    ADD COLUMN session_id INTEGER 
                    REFERENCES sessions(id)
                `, (err) => {
                    if (err) {
                        console.error('Error adding session_id to questions table:', err);
                        // Get questions without filtering by session
                        getQuestionsWithoutSession(res);
                        return;
                    }
                    
                    // Now get questions for the session
                    getQuestionsForSession(sessionName, res);
                });
            } else {
                // Get questions for the session
                getQuestionsForSession(sessionName, res);
            }
        });
    });
}

// Helper function to get questions for a session
function getQuestionsForSession(sessionName, res) {
    if (!sessionName) {
        // For backward compatibility, get all questions
        db.all('SELECT * FROM questions ORDER BY created_at DESC', (err, questions) => {
            if (err) {
                console.error('Error getting all questions:', err);
                res.status(500).json({ error: 'Failed to get questions: ' + err.message });
                return;
            }
            
            res.json(questions || []);
        });
        return;
    }
    
    // Get session ID first
    db.get(
        'SELECT id FROM sessions WHERE name = ?',
        [sessionName],
        (err, session) => {
            if (err) {
                console.error('Error finding session:', err);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }
            
            if (!session) {
                // Session not found, create it
                console.log('Session not found, creating new session:', sessionName);
                db.run(
                    'INSERT INTO sessions (name, password) VALUES (?, ?)',
                    [sessionName, 'default'],
                    function(err) {
                        if (err) {
                            console.error('Error creating session:', err);
                            res.status(500).json({ error: 'Failed to create session: ' + err.message });
                            return;
                        }
                        
                        const sessionId = this.lastID;
                        console.log('Created new session with ID:', sessionId);
                        
                        // Return empty array since this is a new session
                        res.json([]);
                    }
                );
                return;
            }
            
            // Get questions for this session
            console.log('Getting questions for session ID:', session.id);
            db.all(
                'SELECT * FROM questions WHERE session_id = ? ORDER BY created_at DESC',
                [session.id],
                (err, questions) => {
                    if (err) {
                        console.error('Error getting questions for session:', err);
                        res.status(500).json({ error: 'Failed to get questions: ' + err.message });
                        return;
                    }
                    
                    res.json(questions || []);
                }
            );
        }
    );
}

// Helper function to get questions without session filtering
function getQuestionsWithoutSession(res) {
    db.all('SELECT * FROM questions ORDER BY created_at DESC', (err, questions) => {
        if (err) {
            console.error('Error getting all questions:', err);
            res.status(500).json({ error: 'Failed to get questions: ' + err.message });
            return;
        }
        
        res.json(questions || []);
    });
}

// Add new question
app.post('/api/questions', (req, res) => {
    const { content } = req.body;
    
    // Validate content
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Question content is required and must be a string' });
    }
    
    const sessionName = req.query.session;
    console.log('Adding question with content:', content, 'for session:', sessionName);
    
    if (!sessionName) {
        // For backward compatibility, add question without session
        db.run(
            'INSERT INTO questions (content) VALUES (?)',
            [content],
            function(err) {
                if (err) {
                    console.error('Error inserting question without session:', err);
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                const questionId = this.lastID;
                
                // Return the complete question object
                res.json({
                    id: questionId,
                    content: content,
                    status: 'new',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    view_style: 'view1'
                });
            }
        );
        return;
    }
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row) {
            // Sessions table doesn't exist, create it
            db.run(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating sessions table:', err);
                    return res.status(500).json({ error: 'Failed to create sessions table: ' + err.message });
                }
                
                // Now proceed with adding the session and question
                addQuestionWithSession(sessionName, content, res);
            });
        } else {
            // Sessions table exists, proceed with adding the question
            addQuestionWithSession(sessionName, content, res);
        }
    });
});

// Helper function to add a question with session
function addQuestionWithSession(sessionName, content, res) {
    // Get session ID first
    db.get(
        'SELECT id FROM sessions WHERE name = ?',
        [sessionName],
        (err, session) => {
            if (err) {
                console.error('Error finding session:', err);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }
            
            if (!session) {
                // Session not found, create it
                console.log('Session not found, creating new session:', sessionName);
                db.run(
                    'INSERT INTO sessions (name, password) VALUES (?, ?)',
                    [sessionName, 'default'],
                    function(err) {
                        if (err) {
                            console.error('Error creating session:', err);
                            res.status(500).json({ error: 'Failed to create session: ' + err.message });
                            return;
                        }
                        
                        const sessionId = this.lastID;
                        console.log('Created new session with ID:', sessionId);
                        
                        // Check if questions table has session_id column
                        checkAndAddQuestionWithSession(sessionId, content, res);
                    }
                );
                return;
            }
            
            // Add question for this session
            console.log('Adding question for existing session ID:', session.id);
            checkAndAddQuestionWithSession(session.id, content, res);
        }
    );
}

// Helper function to check if questions table has session_id column and add question
function checkAndAddQuestionWithSession(sessionId, content, res) {
    // Check if questions table has session_id column
    db.all("PRAGMA table_info(questions)", (err, rows) => {
        if (err) {
            console.error('Error getting questions table info:', err);
            res.status(500).json({ error: 'Database error: ' + err.message });
            return;
        }
        
        // Check if session_id column exists
        const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
        
        if (!hasSessionId) {
            // Add session_id column to questions table
            db.run(`
                ALTER TABLE questions 
                ADD COLUMN session_id INTEGER 
                REFERENCES sessions(id)
            `, (err) => {
                if (err) {
                    console.error('Error adding session_id to questions table:', err);
                    // Try to add the question without session_id
                    addQuestionWithoutSessionId(content, res);
                    return;
                }
                
                // Now add the question with session_id
                addQuestionWithSessionId(sessionId, content, res);
            });
        } else {
            // Add the question with session_id
            addQuestionWithSessionId(sessionId, content, res);
        }
    });
}

// Helper function to add question with session_id
function addQuestionWithSessionId(sessionId, content, res) {
    db.run(
        'INSERT INTO questions (content, session_id) VALUES (?, ?)',
        [content, sessionId],
        function(err) {
            if (err) {
                console.error('Error inserting question with session_id:', err);
                res.status(500).json({ error: 'Failed to add question: ' + err.message });
                return;
            }
            
            const questionId = this.lastID;
            
            // Create the question object
            const questionObj = {
                id: questionId,
                content: content,
                status: 'new',
                session_id: sessionId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                view_style: 'view1'
            };
            
            // Get the session name for the socket event
            db.get(
                'SELECT name FROM sessions WHERE id = ?',
                [sessionId],
                (err, session) => {
                    if (!err && session) {
                        // Emit socket event to all clients in this session
                        io.to(session.name).emit('question-added', questionObj);
                    }
                }
            );
            
            // Return the complete question object
            res.json(questionObj);
        }
    );
}

// Helper function to add question without session_id
function addQuestionWithoutSessionId(content, res) {
    db.run(
        'INSERT INTO questions (content) VALUES (?)',
        [content],
        function(err) {
            if (err) {
                console.error('Error inserting question without session_id:', err);
                res.status(500).json({ error: 'Failed to add question: ' + err.message });
                return;
            }
            
            const questionId = this.lastID;
            
            // Return the complete question object
            res.json({
                id: questionId,
                content: content,
                status: 'new',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                view_style: 'view1'
            });
        }
    );
}

// Update question status
app.put('/api/questions/:id/status', (req, res) => {
    const questionId = req.params.id;
    const { status } = req.body;
    const sessionName = req.query.session;
    
    console.log('Updating question status:', questionId, 'to', status, 'for session:', sessionName);
    
    // Validate status
    if (!status || typeof status !== 'string' || !['new', 'selected', 'on_air', 'done'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be one of: new, selected, on_air, done' });
    }
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row && sessionName) {
            // Sessions table doesn't exist but session was specified
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (!sessionName) {
            // For backward compatibility, update question without session context
            updateQuestionStatusWithoutSession(questionId, status, res);
            return;
        }
        
        // Get session ID first
        db.get(
            'SELECT id FROM sessions WHERE name = ?',
            [sessionName],
            (err, session) => {
                if (err) {
                    console.error('Error finding session:', err);
                    res.status(500).json({ error: 'Database error: ' + err.message });
                    return;
                }
                
                if (!session) {
                    // Session not found
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                
                // Check if questions table has session_id column
                db.all("PRAGMA table_info(questions)", (err, rows) => {
                    if (err) {
                        console.error('Error getting questions table info:', err);
                        res.status(500).json({ error: 'Database error: ' + err.message });
                        return;
                    }
                    
                    // Check if session_id column exists
                    const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
                    
                    if (!hasSessionId) {
                        // If session_id column doesn't exist, update without session context
                        updateQuestionStatusWithoutSession(questionId, status, res);
                        return;
                    }
                    
                    // Update question status with session context
                    updateQuestionStatusWithSession(questionId, status, session.id, res);
                });
            }
        );
    });
});

// Helper function to update question status without session context
function updateQuestionStatusWithoutSession(questionId, status, res) {
    // If setting to on_air, first set all other questions to 'new'
    if (status === 'on_air') {
        db.run(
            'UPDATE questions SET status = "new" WHERE status = "on_air"',
            (err) => {
                if (err) {
                    console.error('Error resetting on_air questions:', err);
                    res.status(500).json({ error: 'Failed to update question status: ' + err.message });
                    return;
                }
                
                // Now set this question to on_air
                updateSingleQuestionStatus(questionId, status, res);
            }
        );
    } else {
        // Just update this question
        updateSingleQuestionStatus(questionId, status, res);
    }
}

// Helper function to update question status with session context
function updateQuestionStatusWithSession(questionId, status, sessionId, res) {
    // First check if the question belongs to this session
    db.get(
        'SELECT * FROM questions WHERE id = ?',
        [questionId],
        (err, question) => {
            if (err) {
                console.error('Error finding question:', err);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }
            
            if (!question) {
                // Question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            // If question doesn't have a session_id, update it to belong to this session
            if (question.session_id === null) {
                db.run(
                    'UPDATE questions SET session_id = ? WHERE id = ?',
                    [sessionId, questionId],
                    (err) => {
                        if (err) {
                            console.error('Error updating question session:', err);
                            res.status(500).json({ error: 'Failed to update question: ' + err.message });
                            return;
                        }
                        
                        // Now update the status
                        updateQuestionStatusInSession(questionId, status, sessionId, res);
                    }
                );
                return;
            }
            
            // If question belongs to a different session, return error
            if (question.session_id !== sessionId) {
                res.status(403).json({ error: 'Question belongs to a different session' });
                return;
            }
            
            // Update the status
            updateQuestionStatusInSession(questionId, status, sessionId, res);
        }
    );
}

// Helper function to update question status within a session
function updateQuestionStatusInSession(questionId, status, sessionId, res) {
    // If setting to on_air, first set all other questions in this session to 'new'
    if (status === 'on_air') {
        db.run(
            'UPDATE questions SET status = "new" WHERE status = "on_air" AND session_id = ?',
            [sessionId],
            (err) => {
                if (err) {
                    console.error('Error resetting on_air questions in session:', err);
                    res.status(500).json({ error: 'Failed to update question status: ' + err.message });
                    return;
                }
                
                // Now set this question to on_air
                updateSingleQuestionStatus(questionId, status, res);
            }
        );
    } else {
        // Just update this question
        updateSingleQuestionStatus(questionId, status, res);
    }
}

// Helper function to update a single question's status
function updateSingleQuestionStatus(questionId, status, res) {
    db.run(
        'UPDATE questions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, questionId],
        function(err) {
            if (err) {
                console.error('Error updating question status:', err);
                res.status(500).json({ error: 'Failed to update question status: ' + err.message });
                return;
            }
            
            if (this.changes === 0) {
                // No rows affected, question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            // Return the updated question
            db.get(
                'SELECT * FROM questions WHERE id = ?',
                [questionId],
                (err, question) => {
                    if (err) {
                        console.error('Error getting updated question:', err);
                        res.status(500).json({ error: 'Failed to get updated question: ' + err.message });
                        return;
                    }
                    
                    // Get the session name for the socket event
                    if (question.session_id) {
                        db.get(
                            'SELECT name FROM sessions WHERE id = ?',
                            [question.session_id],
                            (err, session) => {
                                if (!err && session) {
                                    // Emit socket event to all clients in this session
                                    io.to(session.name).emit('question-updated', question);
                                    
                                    // If the question is now on_air, emit a special event for the question-view
                                    if (status === 'on_air') {
                                        console.log(`Question ${questionId} is now on air in session ${session.name}`);
                                    }
                                }
                            }
                        );
                    }
                    
                    res.json(question);
                }
            );
        }
    );
}

// Get the current on-air question
app.get('/api/questions/on_air', (req, res) => {
    const sessionName = req.query.session;
    console.log('Getting on-air question for session:', sessionName);
    
    if (!sessionName) {
        // For backward compatibility, get the on-air question without session filtering
        db.get(
            'SELECT * FROM questions WHERE status = "on_air" LIMIT 1',
            (err, question) => {
                if (err) {
                    console.error('Error getting on-air question without session:', err);
                    res.status(500).json({ error: 'Failed to get on-air question: ' + err.message });
                    return;
                }
                
                if (!question) {
                    res.status(404).json({ error: 'No question is currently on air' });
                    return;
                }
                
                res.json(question);
            }
        );
        return;
    }
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row) {
            // Sessions table doesn't exist, return 404
            return res.status(404).json({ error: 'No question is currently on air' });
        }
        
        // Get session ID first
        db.get(
            'SELECT id FROM sessions WHERE name = ?',
            [sessionName],
            (err, session) => {
                if (err) {
                    console.error('Error finding session:', err);
                    res.status(500).json({ error: 'Database error: ' + err.message });
                    return;
                }
                
                if (!session) {
                    // Session not found
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                
                // Check if questions table has session_id column
                db.all("PRAGMA table_info(questions)", (err, rows) => {
                    if (err) {
                        console.error('Error getting questions table info:', err);
                        res.status(500).json({ error: 'Database error: ' + err.message });
                        return;
                    }
                    
                    // Check if session_id column exists
                    const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
                    
                    if (!hasSessionId) {
                        // If session_id column doesn't exist, return 404
                        res.status(404).json({ error: 'No question is currently on air' });
                        return;
                    }
                    
                    // Get the on-air question for this session
                    db.get(
                        'SELECT * FROM questions WHERE status = "on_air" AND session_id = ? LIMIT 1',
                        [session.id],
                        (err, question) => {
                            if (err) {
                                console.error('Error getting on-air question for session:', err);
                                res.status(500).json({ error: 'Failed to get on-air question: ' + err.message });
                                return;
                            }
                            
                            if (!question) {
                                res.status(404).json({ error: 'No question is currently on air for this session' });
                                return;
                            }
                            
                            res.json(question);
                        }
                    );
                });
            }
        );
    });
});

// Delete a question
app.delete('/api/questions/:id', (req, res) => {
    const questionId = req.params.id;
    const sessionName = req.query.session;
    
    console.log('Deleting question:', questionId, 'for session:', sessionName);
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row && sessionName) {
            // Sessions table doesn't exist but session was specified
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (!sessionName) {
            // For backward compatibility, delete question without session context
            deleteQuestionWithoutSession(questionId, res);
            return;
        }
        
        // Get session ID first
        db.get(
            'SELECT id FROM sessions WHERE name = ?',
            [sessionName],
            (err, session) => {
                if (err) {
                    console.error('Error finding session:', err);
                    res.status(500).json({ error: 'Database error: ' + err.message });
                    return;
                }
                
                if (!session) {
                    // Session not found
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                
                // Check if questions table has session_id column
                db.all("PRAGMA table_info(questions)", (err, rows) => {
                    if (err) {
                        console.error('Error getting questions table info:', err);
                        res.status(500).json({ error: 'Database error: ' + err.message });
                        return;
                    }
                    
                    // Check if session_id column exists
                    const hasSessionId = Array.isArray(rows) && rows.some(row => row.name === 'session_id');
                    
                    if (!hasSessionId) {
                        // If session_id column doesn't exist, delete without session context
                        deleteQuestionWithoutSession(questionId, res);
                        return;
                    }
                    
                    // Delete question with session context
                    deleteQuestionWithSession(questionId, session.id, res);
                });
            }
        );
    });
});

// Helper function to delete question without session context
function deleteQuestionWithoutSession(questionId, res) {
    db.run(
        'DELETE FROM questions WHERE id = ?',
        [questionId],
        function(err) {
            if (err) {
                console.error('Error deleting question:', err);
                res.status(500).json({ error: 'Failed to delete question: ' + err.message });
                return;
            }
            
            if (this.changes === 0) {
                // No rows affected, question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            res.json({ success: true, message: 'Question deleted successfully' });
        }
    );
}

// Helper function to delete question with session context
function deleteQuestionWithSession(questionId, sessionId, res) {
    // First check if the question belongs to this session
    db.get(
        'SELECT * FROM questions WHERE id = ?',
        [questionId],
        (err, question) => {
            if (err) {
                console.error('Error finding question:', err);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }
            
            if (!question) {
                // Question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            // If question doesn't have a session_id, it's a global question
            if (question.session_id === null) {
                // Allow deletion of global questions
                deleteQuestionWithoutSession(questionId, res);
                return;
            }
            
            // If question belongs to a different session, return error
            if (question.session_id !== sessionId) {
                res.status(403).json({ error: 'Question belongs to a different session' });
                return;
            }
            
            // Get the session name for the socket event
            db.get(
                'SELECT name FROM sessions WHERE id = ?',
                [sessionId],
                (err, session) => {
                    if (err) {
                        console.error('Error getting session name:', err);
                    }
                    
                    // Delete the question
                    db.run(
                        'DELETE FROM questions WHERE id = ?',
                        [questionId],
                        function(err) {
                            if (err) {
                                console.error('Error deleting question from session:', err);
                                res.status(500).json({ error: 'Failed to delete question: ' + err.message });
                                return;
                            }
                            
                            if (this.changes === 0) {
                                // No rows affected, question not found
                                res.status(404).json({ error: 'Question not found' });
                                return;
                            }
                            
                            // Emit socket event if session was found
                            if (session) {
                                io.to(session.name).emit('question-deleted', { id: questionId });
                            }
                            
                            res.json({ success: true, message: 'Question deleted successfully' });
                        }
                    );
                }
            );
        }
    );
}

// Session management endpoints

// Create a new session
app.post('/api/sessions', (req, res) => {
    const { name, password } = req.body;
    
    if (!name || !password) {
        res.status(400).json({ error: 'Session name and password are required' });
        return;
    }
    
    db.run(
        'INSERT INTO sessions (name, password) VALUES (?, ?)',
        [name, password],
        function(err) {
            if (err) {
                // Check if it's a unique constraint error
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(409).json({ error: 'A session with this name already exists' });
                    return;
                }
                
                res.status(500).json({ error: err.message });
                return;
            }
            
            res.json({
                id: this.lastID,
                name,
                created_at: new Date().toISOString()
            });
        }
    );
});

// Verify session credentials
app.post('/api/sessions/verify', (req, res) => {
    const { name, password } = req.body;
    
    if (!name || !password) {
        res.status(400).json({ error: 'Session name and password are required' });
        return;
    }
    
    db.get(
        'SELECT id, name, created_at FROM sessions WHERE name = ? AND password = ?',
        [name, password],
        (err, session) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!session) {
                res.status(401).json({ error: 'Invalid session name or password' });
                return;
            }
            
            res.json(session);
        }
    );
});

// Update question content
app.put('/api/questions/:id', (req, res) => {
    const questionId = req.params.id;
    const { content } = req.body;
    const sessionName = req.query.session;
    
    console.log('Updating question content:', questionId, 'for session:', sessionName);
    
    // Validate content
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Question content is required and must be a string' });
    }
    
    // First check if the sessions table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
        if (err) {
            console.error('Error checking for sessions table:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        if (!row && sessionName) {
            // Sessions table doesn't exist but session was specified
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (!sessionName) {
            // For backward compatibility, update question without session context
            updateQuestionContentWithoutSession(questionId, content, res);
            return;
        }
        
        // Get session ID first
        db.get(
            'SELECT id FROM sessions WHERE name = ?',
            [sessionName],
            (err, session) => {
                if (err) {
                    console.error('Error finding session:', err);
                    res.status(500).json({ error: 'Database error: ' + err.message });
                    return;
                }
                
                if (!session) {
                    // Session not found
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                
                // Update question with session context
                updateQuestionContentWithSession(questionId, content, session.id, sessionName, res);
            }
        );
    });
});

// Helper function to update question content without session context
function updateQuestionContentWithoutSession(questionId, content, res) {
    db.run(
        'UPDATE questions SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [content, questionId],
        function(err) {
            if (err) {
                console.error('Error updating question content:', err);
                res.status(500).json({ error: 'Failed to update question: ' + err.message });
                return;
            }
            
            if (this.changes === 0) {
                // No rows affected, question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            // Return the updated question
            db.get(
                'SELECT * FROM questions WHERE id = ?',
                [questionId],
                (err, question) => {
                    if (err) {
                        console.error('Error getting updated question:', err);
                        res.status(500).json({ error: 'Failed to get updated question: ' + err.message });
                        return;
                    }
                    
                    res.json(question);
                }
            );
        }
    );
}

// Helper function to update question content with session context
function updateQuestionContentWithSession(questionId, content, sessionId, sessionName, res) {
    // First check if the question belongs to this session
    db.get(
        'SELECT * FROM questions WHERE id = ?',
        [questionId],
        (err, question) => {
            if (err) {
                console.error('Error finding question:', err);
                res.status(500).json({ error: 'Database error: ' + err.message });
                return;
            }
            
            if (!question) {
                // Question not found
                res.status(404).json({ error: 'Question not found' });
                return;
            }
            
            // If question doesn't have a session_id, update it to belong to this session
            if (question.session_id === null) {
                db.run(
                    'UPDATE questions SET session_id = ? WHERE id = ?',
                    [sessionId, questionId],
                    (err) => {
                        if (err) {
                            console.error('Error updating question session:', err);
                            res.status(500).json({ error: 'Failed to update question: ' + err.message });
                            return;
                        }
                    }
                );
            }
            // If question belongs to a different session, return error
            else if (question.session_id !== sessionId) {
                res.status(403).json({ error: 'Question belongs to a different session' });
                return;
            }
            
            // Update the content
            db.run(
                'UPDATE questions SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [content, questionId],
                function(err) {
                    if (err) {
                        console.error('Error updating question content:', err);
                        res.status(500).json({ error: 'Failed to update question: ' + err.message });
                        return;
                    }
                    
                    if (this.changes === 0) {
                        // No rows affected, question not found
                        res.status(404).json({ error: 'Question not found' });
                        return;
                    }
                    
                    // Return the updated question
                    db.get(
                        'SELECT * FROM questions WHERE id = ?',
                        [questionId],
                        (err, updatedQuestion) => {
                            if (err) {
                                console.error('Error getting updated question:', err);
                                res.status(500).json({ error: 'Failed to get updated question: ' + err.message });
                                return;
                            }
                            
                            // Emit socket event to all clients in this session
                            io.to(sessionName).emit('question-updated', updatedQuestion);
                            
                            res.json(updatedQuestion);
                        }
                    );
                }
            );
        }
    );
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 