from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime

app = Flask(__name__)

def get_db():
    db = sqlite3.connect('db/questions.db')
    db.row_factory = sqlite3.Row
    return db

@app.route('/api/questions', methods=['GET'])
def get_questions():
    db = get_db()
    questions = db.execute('SELECT * FROM questions WHERE status != "done" ORDER BY created_at DESC').fetchall()
    return jsonify([dict(q) for q in questions])

@app.route('/api/questions', methods=['POST'])
def add_question():
    content = request.json.get('content')
    db = get_db()
    cursor = db.execute(
        'INSERT INTO questions (content) VALUES (?)',
        [content]
    )
    db.commit()
    return jsonify({'id': cursor.lastrowid, 'content': content, 'status': 'new'})

@app.route('/api/questions/<int:id>/status', methods=['PUT'])
def update_status(id):
    status = request.json.get('status')
    view_style = request.json.get('view_style', 'view1')
    
    db = get_db()
    # If moving to on_air, clear other on_air questions first
    if status == 'on_air':
        db.execute('UPDATE questions SET status = "selected" WHERE status = "on_air"')
    
    db.execute(
        'UPDATE questions SET status = ?, view_style = ?, updated_at = ? WHERE id = ?',
        [status, view_style, datetime.now(), id]
    )
    db.commit()
    return jsonify({'success': True})

@app.route('/api/questions/on_air', methods=['GET'])
def get_on_air():
    view = request.args.get('view', 'view1')
    db = get_db()
    question = db.execute(
        'SELECT * FROM questions WHERE status = "on_air" AND view_style = ?',
        [view]
    ).fetchone()
    return jsonify(dict(question) if question else {})

if __name__ == '__main__':
    app.run(debug=True) 