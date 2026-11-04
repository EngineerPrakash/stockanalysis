FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8501
# Default: run the daily report. Override with `streamlit run app.py --server.address=0.0.0.0` for the dashboard.
CMD ["python", "-m", "stock_analyzer", "--notify"]
